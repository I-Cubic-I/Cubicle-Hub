const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

// ---- preset state ----
let presets = [];
let isDev = false;
let selectedCuda = "";
let selectedTorch = "";
let baseImageOverride = "";
let selectionMode = "cuda-first"; // or 'torch-first'
let envCustomizerMounted = false;

// ---- system packages (apt) ----
const lockedAptPackages = ["git"]; // 고정(삭제 불가)
let aptPackages = [];              // 사용자가 추가한 패키지들 (git 제외)
let aptWarn = "";                 // 검증 경고/상태

// ---- helpers ----
function uniq(arr) {
  return [...new Set(arr)];
}

function getTorchesForCuda(cuda) {
  if (!cuda) return uniq(presets.map(p => p.torch)).sort(compareSemverDesc);
  return uniq(presets.filter(p => p.cuda === cuda).map(p => p.torch)).sort(compareSemverDesc);
}
function getCudasForTorch(torch) {
  if (!torch) return uniq(presets.map(p => p.cuda)).sort(compareSemverDesc);
  return uniq(presets.filter(p => p.torch === torch).map(p => p.cuda)).sort(compareSemverDesc);
}
function applyTemplate(tpl, tagBase) {
  return (tpl || "").replaceAll("{tagBase}", tagBase);
}

function parseSemver(v) {
  // "2.10.0", "2.10", "2.10.0+cu121", "2.10.0-rc1" 같은 변형을 최대한 안전하게 처리
  const s = (v || "").trim();

  // 앞부분의 숫자/점만 우선 추출 (예: "2.10.0-rc1" -> "2.10.0")
  const core = (s.match(/^\d+(?:\.\d+){0,3}/) || ["0"])[0];
  const parts = core.split(".").map(x => Number(x));

  // 길이 맞추기 (major.minor.patch.build)
  while (parts.length < 4) parts.push(0);

  return parts; // [major, minor, patch, build]
}

function compareSemverDesc(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  for (let i = 0; i < 4; i++) {
    if (A[i] !== B[i]) return B[i] - A[i]; // 내림차순(최신 먼저)
  }
  // 숫자 같으면 원문 비교로 안정화(완전 동일 처리)
  return String(b).localeCompare(String(a));
}

function findBaseImage(cuda, torch) {
  const hit = presets.find(p => p.cuda === cuda && p.torch === torch);
  if (!hit?.tagBase) return "";

  const fallback = isDev ? "{tagBase}-devel" : "{tagBase}-runtime";
  const tpl = hit.variants
    ? (isDev ? hit.variants.devel : hit.variants.runtime) || fallback
    : fallback;

  return applyTemplate(tpl, hit.tagBase);
}

function escapeHtml(s) {
  return (s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function deriveModel() {
  const allCudas = uniq(presets.map(p => p.cuda)).sort(compareSemverDesc);
  const allTorches = uniq(presets.map(p => p.torch)).sort(compareSemverDesc);

  // 호환 리스트
  const torchesForCuda = selectedCuda ? getTorchesForCuda(selectedCuda) : [];
  const cudasForTorch  = selectedTorch ? getCudasForTorch(selectedTorch) : [];

  // custom-base가 아닐 때만 조합 일관성 보정
  if (selectionMode !== "custom-base" && selectedCuda && selectedTorch) {
    const ok = presets.some(p => p.cuda === selectedCuda && p.torch === selectedTorch);
    if (!ok) {
      if (selectionMode === "cuda-first") selectedTorch = "";
      else if (selectionMode === "torch-first") selectedCuda = "";
    }
  }

  // 실제 베이스 이미지
  const effectiveBase =
    selectionMode === "custom-base"
      ? baseImageOverride.trim()
      : (selectedCuda && selectedTorch ? findBaseImage(selectedCuda, selectedTorch) : "");

  // Dockerfile 미리보기(일단 최소)
  const dockerfileText = buildDockerfilePreview({
    baseImage: effectiveBase,
    selectionMode,
    selectedCuda,
    selectedTorch,
    isDev
  });

  // Generate 가능 여부
  const canGenerate =
    selectionMode === "custom-base"
      ? !!effectiveBase
      : !!(selectedCuda && selectedTorch);

  return {
    allCudas,
    allTorches,
    torchesForCuda,
    cudasForTorch,
    effectiveBase,
    dockerfileText,
    canGenerate,
    isCustom: selectionMode === "custom-base"
  };
}

function normalizePkgName(s) {
  return (s || "").trim().toLowerCase();
}

function isValidPkgName(s) {
  // apt 패키지명은 대체로 [a-z0-9][a-z0-9+.-]+ 형태가 많음
  // 너무 엄격하게 막지 말고 최소한만 체크
  return /^[a-z0-9][a-z0-9+.-]*$/.test(s);
}

function addAptPackage(raw) {
  const name = normalizePkgName(raw);
  if (!name) return;

  if (!isValidPkgName(name)) {
    aptWarn = `Invalid package name: "${raw}"`;
    return;
  }

  if (lockedAptPackages.includes(name)) {
    aptWarn = `"${name}" is already included (locked).`;
    return;
  }

  if (aptPackages.includes(name)) {
    aptWarn = `"${name}" is already in the list.`;
    return;
  }

  aptWarn = "";
  aptPackages.push(name);
}

function removeAptPackage(name) {
  aptPackages = aptPackages.filter(p => p !== name);
  aptWarn = "";
}

function updateAptSection() {
  const hint = document.getElementById("aptHint");
  const chips = document.getElementById("aptChips");

  if (hint) {
    if (aptWarn) {
      hint.style.opacity = "1";
      hint.style.color = "var(--vscode-errorForeground, #ff6b6b)";
      hint.textContent = aptWarn;
    } else {
      hint.style.color = "";
      hint.style.opacity = "0.75";
      hint.textContent = "Press Enter to add. Duplicate names are ignored.";
    }
  }

  if (chips) {
    chips.innerHTML = renderAptChipsHtml();
  }
}

function buildDockerfilePreview({ baseImage }) {
  if (!baseImage) return `# Select versions or enter a base image\n`;

  const allPkgs = [...lockedAptPackages, ...aptPackages];

  const aptBlock = allPkgs.length
    ? `\n# System packages\nRUN apt-get update && apt-get install -y --no-install-recommends \\\n` +
      allPkgs.map(p => `    ${p} \\`).join("\n") +
      `\n && rm -rf /var/lib/apt/lists/*\n`
    : "";

  return `FROM ${baseImage}\n` +
         aptBlock +
         `\n# TODO: add steps here\n`;
}

// ---- screens ----
function renderWelcome() {
  root.innerHTML = `
    <div style="padding:16px; font-family: sans-serif; line-height:1.4;">
      <h2>Cubicle Hub</h2>
      <p>Default mode is <b>Local Docker Mode</b>. Agent setup is optional for now.</p>

      <div style="margin-top:12px; display:flex; gap:8px;">
        <button id="btnGo">Open Environment Customizer</button>
        <button id="btnInstall">Install Agent (placeholder)</button>
      </div>

      <hr style="margin:16px 0;" />

      <p style="opacity:0.75;">
        Environment Customizer generates <b>Dockerfile</b> and optional <b>docker-compose.yml</b>.
        (No build/run in Docker-only mode.)
      </p>
    </div>
  `;

  document.getElementById("btnGo").onclick = () => {
    vscode.postMessage({ type: "navigate", route: "envCustomizer" });
  };
  document.getElementById("btnInstall").onclick = () => {
    vscode.postMessage({ type: "agent.install.placeholder" });
  };
}

function renderEnvCustomizer() {
  // Lazy-load presets once
  if (presets.length === 0) {
    vscode.postMessage({ type: "preset.load" });
    root.innerHTML = `
      <div style="padding:16px;font-family:sans-serif;">
        <h2>Environment Customizer</h2>
        <p>Loading presets...</p>
      </div>
    `;
    envCustomizerMounted = false;
    return;
  }

  if (!envCustomizerMounted) {
    root.innerHTML = `
      <style>
        .apt-chip {
          display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
          border-radius:999px; background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-editorWidget-border);
          user-select: none;
        }
        .apt-chip.removable {
          cursor: pointer;
        }
        .apt-chip.removable:hover {
          border-color: var(--vscode-errorForeground);
        }
        .apt-chip.removable:active {
          opacity: 0.9;
        }
        .apt-chip.locked {
          cursor: default;
          opacity: 0.9;
        }
        .apt-lock {
          display:inline-flex; align-items:center; 
          color: var(--vscode-descriptionForeground); opacity: 0.85;
        }
      </style>

      <div style="padding:16px; font-family:sans-serif; line-height:1.35; max-width:1200px;">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
          <h2 style="margin:0;">Environment Customizer</h2>
          <div style="opacity:0.7;">Docker-only mode · templates only</div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:clamp(18px, 3.33vw, 40px); margin-top:14px;">
          <div id="envForm" style="min-width:0;"></div>
          <div id="envPreview" style="min-width:0;"></div>
        </div>
      </div>
    `;
    envCustomizerMounted = true;
  }

  renderAll();
}

function renderAll() {
  const model = deriveModel();
  renderForm(model);
  renderPreview(model);
}

function renderForm(model) {
  const form = document.getElementById("envForm");
  if (!form) return;

  form.innerHTML = `
    <div style="padding:0; font-family:sans-serif; line-height:1.35;">
      <p style="margin-top:0; opacity:0.8;">
        Choose selection order, then pick versions sequentially.
      </p>

      <!-- selection mode radios -->
      <div style="margin-top:8px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
        <label><input type="radio" name="order" value="cuda-first" ${selectionMode === 'cuda-first' ? 'checked' : ''}/> CUDA first</label>
        <label><input type="radio" name="order" value="torch-first" ${selectionMode === 'torch-first' ? 'checked' : ''}/> PyTorch first</label>
        <label><input type="radio" name="order" value="custom-base" ${selectionMode === 'custom-base' ? 'checked' : ''}/> Custom base image</label>
      </div>

      <!-- selectors -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:clamp(18px, 3.33vw, 40px); margin-top:14px;">
        ${
          selectionMode === "cuda-first" ? `
            <div>
              <label><b>CUDA Version</b></label><br/>
              <select id="selCudaFirst" style="width:100%; padding:6px; box-sizing:border-box;">
                <option value="" ${selectedCuda === "" ? "selected" : ""} disabled>Choose CUDA...</option>
                ${model.allCudas.map(v =>
                  `<option value="${escapeHtml(v)}" ${v === selectedCuda ? "selected" : ""}>${escapeHtml(v)}</option>`
                ).join("")}
              </select>
            </div>

            <div id="torchBox" style="${selectedCuda ? "" : "display:none;"}">
              <label><b>PyTorch Version</b></label><br/>
              <select id="selTorchFromCuda" style="width:100%; padding:6px; box-sizing:border-box;">
                <option value="" ${selectedTorch === "" ? "selected" : ""} disabled>Choose PyTorch...</option>
                ${model.torchesForCuda.map(v =>
                  `<option value="${escapeHtml(v)}" ${v === selectedTorch ? "selected" : ""}>${escapeHtml(v)}</option>`
                ).join("")}
              </select>
            </div>
          ` : selectionMode === "torch-first" ? `
            <div>
              <label><b>PyTorch Version</b></label><br/>
              <select id="selTorchFirst" style="width:100%; padding:6px; box-sizing:border-box;">
                <option value="" ${selectedTorch === "" ? "selected" : ""} disabled>Choose PyTorch...</option>
                ${model.allTorches.map(v =>
                  `<option value="${escapeHtml(v)}" ${v === selectedTorch ? "selected" : ""}>${escapeHtml(v)}</option>`
                ).join("")}
              </select>
            </div>

            <div id="cudaBox" style="${selectedTorch ? "" : "display:none;"}">
              <label><b>CUDA Version</b></label><br/>
              <select id="selCudaFromTorch" style="width:100%; padding:6px; box-sizing:border-box;">
                <option value="" ${selectedCuda === "" ? "selected" : ""} disabled>Choose CUDA...</option>
                ${model.cudasForTorch.map(v =>
                  `<option value="${escapeHtml(v)}" ${v === selectedCuda ? "selected" : ""}>${escapeHtml(v)}</option>`
                ).join("")}
              </select>
            </div>
          ` : `
            <div style="grid-column: 1 / -1;">
              <label><b>Base Image</b></label><br/>
              <input id="inpBaseCustom" style="width:100%; padding:6px; box-sizing:border-box;"
                placeholder="e.g. pytorch/pytorch:2.10.0-cuda13.0-cudnn9"
                value="${escapeHtml(baseImageOverride)}" />
              <div style="margin-top:6px; font-size:12px; opacity:0.75;">
                We will use this image directly as the <code>FROM</code> line.
              </div>
            </div>
          `
        }
      </div>

      <!-- dev/runtime toggle -->
      ${
        selectionMode !== "custom-base" ? `
          <div style="margin-top:14px;">
            <label style="user-select:none;">
              <input id="chkDev" type="checkbox" ${isDev ? "checked" : ""}/>
              For development (devel)
            </label>
            <div style="margin-top:6px; font-size:12px; opacity:0.75;">
              ${isDev ? "Using -devel variant when available." : "Using -runtime variant when available."}
            </div>
          </div>
        ` : `
          <div style="margin-top:14px; font-size:12px; opacity:0.75;">
            Dev/runtime toggle is disabled in Custom base mode.
          </div>
        `
      }

      <!-- system packages (apt) -->
      <div style="margin-top:16px;">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
          <label><b>System packages (apt)</b></label>
          <div style="font-size:12px; opacity:0.7;">Installed during image build</div>
        </div>

        <input
          id="inpApt"
          style="width:100%; padding:6px; box-sizing:border-box; margin-top:6px;"
          placeholder="Type a package name and press Enter (e.g. curl, build-essential)"
          autocomplete="off"
        />

        <div id="aptHint" style="margin-top:6px; font-size:12px; opacity:0.75;"></div>

        <div id="aptChips" style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;"></div>
      </div>

      <!-- actions -->
      <div style="margin-top:14px; display:flex; gap:8px; align-items:center;">
        <button id="btnGen" ${model.canGenerate ? "" : "disabled"}>Generate Template Files</button>
      </div>
    </div>
  `;
  updateAptSection();

  // -----------------------
  // wiring
  // -----------------------

  // Mode radios: 구조가 바뀌므로 전체 재렌더
  const orderRadios = form.querySelectorAll('input[name="order"]');
  orderRadios.forEach(r => {
    r.onchange = (e) => {
      selectionMode = e.target.value;
      selectedCuda = "";
      selectedTorch = "";
      // baseImageOverride는 유지(너 의도대로). 원하면 여기서 "" 처리.
      renderEnvCustomizer();
    };
  });

  // CUDA-first: CUDA change => torch 최신 자동선택 => 전체 재렌더
  const selCudaFirst = document.getElementById("selCudaFirst");
  if (selCudaFirst) {
    selCudaFirst.onchange = (e) => {
      selectedCuda = e.target.value;
      const candidates = getTorchesForCuda(selectedCuda);
      selectedTorch = candidates[0] || "";
      renderEnvCustomizer();
    };
  }

  // CUDA-first: torch change => 전체 재렌더
  const selTorchFromCuda = document.getElementById("selTorchFromCuda");
  if (selTorchFromCuda) {
    selTorchFromCuda.onchange = (e) => {
      selectedTorch = e.target.value;
      renderEnvCustomizer();
    };
  }

  // Torch-first: torch change => cuda 최신 자동선택 => 전체 재렌더
  const selTorchFirst = document.getElementById("selTorchFirst");
  if (selTorchFirst) {
    selTorchFirst.onchange = (e) => {
      selectedTorch = e.target.value;
      const candidates = getCudasForTorch(selectedTorch);
      selectedCuda = candidates[0] || "";
      renderEnvCustomizer();
    };
  }

  // Torch-first: cuda change => 전체 재렌더
  const selCudaFromTorch = document.getElementById("selCudaFromTorch");
  if (selCudaFromTorch) {
    selCudaFromTorch.onchange = (e) => {
      selectedCuda = e.target.value;
      renderEnvCustomizer();
    };
  }

  // Custom base: typing => 상태만 업데이트 (+ preview만 업데이트하고 싶으면 아래 주석 해제)
  const inpBaseCustom = document.getElementById("inpBaseCustom");
  if (inpBaseCustom) {
    inpBaseCustom.oninput = (e) => {
      baseImageOverride = e.target.value;
      // ✅ 커서 튐 없이 실시간 미리보기만 갱신하고 싶으면:
      renderPreview(deriveModel());
    };
  }

  // Dev toggle: 문구+base가 바뀌므로 전체 재렌더(단, preview만 갱신해도 되면 renderPreviewOnly로)
  const chkDev = document.getElementById("chkDev");
  if (chkDev) {
    chkDev.onchange = (e) => {
      isDev = e.target.checked;
      renderEnvCustomizer();
    };
  }

  // Apt input: Enter로 추가
  const inpApt = document.getElementById("inpApt");
  if (inpApt) {
    inpApt.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addAptPackage(inpApt.value);
        inpApt.value = "";
        updateAptSection();
        renderPreview(deriveModel());
      }
    };
  }

  // Apt remove 버튼 (칩의 X)
  const aptChips = document.getElementById("aptChips");
  if (aptChips) {
    aptChips.onclick = (e) => {
      const chip = e.target?.closest?.("[data-apt-remove]");
      if (!chip) return;

      const name = chip.getAttribute("data-apt-remove");
      if (!name) return;

      removeAptPackage(name);
      updateAptSection();
      renderPreview(deriveModel());

      // (선택) UX: 입력창으로 포커스 복귀
      document.getElementById("inpApt")?.focus();
    };
  }

  // Generate (custom-base 포함)
  const btnGen = document.getElementById("btnGen");
  if (btnGen) {
    btnGen.onclick = () => {
      const m = deriveModel();

      if (!m.canGenerate) {
        vscode.postMessage({
          type: "toast",
          message: selectionMode === "custom-base"
            ? "Enter a base image."
            : "Select CUDA and PyTorch first."
        });
        return;
      }

      const payload = {
        mode: "dockerOnly",
        cuda: selectedCuda,
        torch: selectedTorch,
        isDev,
        baseImage: m.effectiveBase,
        imageTag: document.getElementById("inpTag").value.trim() || "cubicle/custom:latest",
        makeCompose: document.getElementById("chkCompose").checked,
        extraPip: document.getElementById("txtPip").value || ""
      };

      vscode.postMessage({ type: "image.generateFiles", payload });
    };
  }
}

const LOCK_SVG = `
<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
     style="display:block; fill: currentColor;">
  <path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V7zm7 12H7v-8h10v8z"/>
</svg>`;

function renderAptChipsHtml() {
  const all = [...lockedAptPackages, ...aptPackages];

  return all.map(name => {
    const locked = lockedAptPackages.includes(name);

    if (locked) {
      return `
        <span class="apt-chip locked" title="locked">
          ${escapeHtml(name)}
          <span class="apt-lock" title="locked">${LOCK_SVG}</span>
        </span>
      `;
    }

    return `
      <span class="apt-chip removable" data-apt-remove="${name}"
            title="Click to remove">
        ${escapeHtml(name)}
      </span>
    `;
  }).join("");
}

function renderPreview(model) {
  const box = document.getElementById("envPreview");
  if (!box) return;

  box.innerHTML = `
    <div style="font-family:sans-serif;">
      <div style="opacity:0.8; margin-bottom:8px;"><b>Dockerfile preview</b></div>
      <pre style="margin:0; padding:12px; background:rgba(127,127,127,0.12); border-radius:8px; overflow:auto; white-space:pre;">
${escapeHtml(model.dockerfileText || "")}
      </pre>
    </div>
  `;
}


// ---- router ----
function navigate(route) {
  if (route === "welcome") renderWelcome();
  else renderEnvCustomizer();
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "navigate") {
    navigate(msg.route);
  }

  if (msg.type === "preset.data") {
    try {
      const data = JSON.parse(msg.text);
      presets = Array.isArray(data.presets) ? data.presets : [];
      // reset selections
      selectedCuda = "";
      selectedTorch = "";
      baseImageOverride = "";
      aptPackages = [];
      aptWarn = "";
      renderEnvCustomizer();
    } catch (e) {
      console.error("Failed to parse preset.data", e);
    }
  }
});

// start
vscode.postMessage({ type: "ready" });
