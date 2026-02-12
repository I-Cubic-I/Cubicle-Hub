const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

// ---- preset state ----
let presets = [];
let isDev = false;
let selectedCuda = "";
let selectedTorch = "";
let baseImageOverride = "";
let selectionMode = "cuda-first"; // or 'torch-first'

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
    return;
  }

  const allCudas = uniq(presets.map(p => p.cuda)).sort(compareSemverDesc);
  const allTorches = uniq(presets.map(p => p.torch)).sort(compareSemverDesc);

  const torchesForCuda = selectedCuda ? getTorchesForCuda(selectedCuda) : [];
  const cudasForTorch = selectedTorch ? getCudasForTorch(selectedTorch) : [];

  // Make selections consistent
  // If cuda selected but torch invalid -> reset torch
  if (selectionMode !== "custom-base" && selectedCuda && selectedTorch) {
    const ok = presets.some(p => p.cuda === selectedCuda && p.torch === selectedTorch);
    if (!ok) {
        if (selectionMode === "cuda-first") selectedTorch = "";
        else selectedCuda = ""; // "cuda 먼저 선택" 흐름이면 torch만 다시 고르게
    }
  }

  // base image는 둘 다 선택된 후에만 제안
  const effectiveBase =
    selectionMode === "custom-base"
      ? baseImageOverride.trim()
      : (selectedCuda && selectedTorch ? findBaseImage(selectedCuda, selectedTorch) : "");

  // ---- UI ----
  root.innerHTML = `
    <div style="padding:16px; font-family:sans-serif; line-height:1.35; max-width:980px;">
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
        <h2 style="margin:0;">Environment Customizer</h2>
        <div style="opacity:0.7;">Docker-only mode · templates only</div>
      </div>

      <p style="margin-top:8px; opacity:0.8;">
        Choose selection order, then pick versions sequentially.
      </p>

      <!-- 베이스 이미지 선택 라디오 버튼 -->
      <div style="margin-top:8px; display:flex; gap:12px; align-items:center;">
        <label style="margin-right:8px;"><input type="radio" name="order" value="cuda-first" ${selectionMode === 'cuda-first' ? 'checked' : ''}/> CUDA first</label>
        <label style="margin-right:8px;"><input type="radio" name="order" value="torch-first" ${selectionMode === 'torch-first' ? 'checked' : ''}/> PyTorch first</label>
        <label><input type="radio" name="order" value="custom-base" ${selectionMode === 'custom-base' ? 'checked' : ''}/> Custom base image</label>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:14px;">

        <!-- selectionMode에 따라서, 드롭다운 또는 텍스트 입력란 표시 -->
        ${selectionMode === 'cuda-first' ? `
        <div>
          <label><b>CUDA Version</b></label><br/>
          <select id="selCudaFirst" style="width:100%; padding:6px;">
            <option value="" ${selectedCuda === "" ? "selected" : ""} disabled>Choose CUDA...</option>
            ${(allCudas).map(v =>
              `<option value="${escapeHtml(v)}" ${v === selectedCuda ? "selected" : ""}>${escapeHtml(v)}</option>`
            ).join("")}
          </select>
        </div>

        <div id="torchBox" style="${selectedCuda ? '' : 'display:none;'}">
          <label><b>PyTorch Version</b></label><br/>
          <select id="selTorchFromCuda" style="width:100%; padding:6px;">
            <option value="" ${selectedTorch === "" ? "selected" : ""} disabled>Choose PyTorch...</option>
            ${torchesForCuda.map(v =>
              `<option value="${escapeHtml(v)}" ${v === selectedTorch ? "selected" : ""}>${escapeHtml(v)}</option>`
            ).join("")}
          </select>
        </div>
        ` : selectionMode === 'torch-first' ? `
        <div>
          <label><b>PyTorch Version</b></label><br/>
          <select id="selTorchFirst" style="width:100%; padding:6px;">
            <option value="" ${selectedTorch === "" ? "selected" : ""} disabled>Choose PyTorch...</option>
            ${allTorches.map(v => `<option value="${escapeHtml(v)}" ${v === selectedTorch ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
          </select>
        </div>

        <div id="cudaBox" style="${selectedTorch ? '' : 'display:none;'}">
          <label><b>CUDA Version</b></label><br/>
          <select id="selCudaFromTorch" style="width:100%; padding:6px;">
            <option value="" ${selectedCuda === "" ? "selected" : ""} disabled>Choose CUDA...</option>
            ${(cudasForTorch).map(v =>
              `<option value="${escapeHtml(v)}" ${v === selectedCuda ? "selected" : ""}>${escapeHtml(v)}</option>`
            ).join("")}
          </select>
        </div>
        ` : `
        <div>
          <label><b>Base Image</b></label><br/>
          <input id="inpBaseCustom" style="width:100%; padding:6px;"
            placeholder="e.g. pytorch/pytorch:2.10.0-cuda13.0-cudnn9"
            value="${escapeHtml(baseImageOverride)}" />
          <div style="margin-top:6px; font-size:12px; opacity:0.75;">
            We will use this image directly as the <code>FROM</code> line.
          </div>
        </div>
        `}

      </div>

      <!-- runtime / devel 선택 체크 박스 -->
      ${selectionMode !== 'custom-base' ? `
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
        `}

      <div style="margin-top:14px; opacity:0.85;">
        <b>Suggested base image:</b>
        <div style="margin-top:6px; padding:10px; background: rgba(127,127,127,0.12); border-radius: 8px;">
          <code>${escapeHtml(effectiveBase || "(select versions or enter base image)")}</code>
        </div>
      </div>

      <!-- 나머지 폼(override, devel/runtime, compose, pip 등)은 그대로 붙이면 됨 -->
    </div>
  `;

    // ---- wiring (stage-based) ----

    // CUDA (cuda-first): 초기 CUDA 셀렉터
    const selCudaFirst = document.getElementById("selCudaFirst");
    if (selCudaFirst) {
    selCudaFirst.onchange = (e) => {
      selectedCuda = e.target.value;

      const candidates = getTorchesForCuda(selectedCuda);
      selectedTorch = candidates[0] || "";

      renderEnvCustomizer();
    };
    }

    // Torch (CUDA-first 흐름에서 CUDA 선택 후 나타나는 Torch)
    const selTorchFromCuda = document.getElementById("selTorchFromCuda");
    if (selTorchFromCuda) {
    selTorchFromCuda.onchange = (e) => {
      selectedTorch = e.target.value;
      renderEnvCustomizer();
    };
    }

    // Torch-first (아직 아무것도 선택 안 했을 때만 존재)
    const selTorchFirst = document.getElementById("selTorchFirst");
    if (selTorchFirst) {
    selTorchFirst.onchange = (e) => {
      selectedTorch = e.target.value;

      const candidates = getCudasForTorch(selectedTorch);
      selectedCuda = candidates[0] || "";

      renderEnvCustomizer();
    };
    }

    // CUDA 선택 when torch-first path (selCudaFromTorch)
    const selCudaFromTorch = document.getElementById("selCudaFromTorch");
    if (selCudaFromTorch) {
      selCudaFromTorch.onchange = (e) => {
        selectedCuda = e.target.value;
        renderEnvCustomizer();
      };
    }

    // Order radio buttons
    const orderRadios = document.querySelectorAll('input[name="order"]');
    if (orderRadios && orderRadios.length) {
      orderRadios.forEach(r => r.onchange = (e) => {
        selectionMode = e.target.value;
        // reset selections when switching mode
        selectedCuda = "";
        selectedTorch = "";
        //baseImageOverride = "";
        renderEnvCustomizer();
      });
    }

    const inpBaseCustom = document.getElementById("inpBaseCustom");
    if (inpBaseCustom) {
      inpBaseCustom.oninput = (e) => {
        baseImageOverride = e.target.value;
        //renderEnvCustomizer(); // 즉시 suggested 반영 원하면
      };
      inpBaseCustom.onblur = () => renderEnvCustomizer();
    }
    
    // dev/runtime toggle (항상 존재로 렌더했다면)
    const chkDev = document.getElementById("chkDev");
    if (chkDev) {
    chkDev.onchange = (e) => {
        isDev = e.target.checked;
        renderEnvCustomizer(); // suggested base image 갱신
    };
    }

    // Generate: 둘 다 선택된 경우에만 유효하게
    const btnGen = document.getElementById("btnGen");
    if (btnGen) {
    btnGen.onclick = () => {
        // 둘 중 하나라도 없으면 안내(또는 버튼 disabled를 렌더에서 처리)
        if (!selectedCuda || !selectedTorch) {
        vscode.postMessage({ type: "toast", message: "Select CUDA and PyTorch first." });
        return;
        }

        const baseImage = baseImageOverride.trim()
        ? baseImageOverride.trim()
        : findBaseImage(selectedCuda, selectedTorch);

        const payload = {
        mode: "dockerOnly",
        cuda: selectedCuda,
        torch: selectedTorch,
        isDev,
        baseImage,
        imageTag: document.getElementById("inpTag").value.trim() || "cubicle/custom:latest",
        makeCompose: document.getElementById("chkCompose").checked,
        extraPip: document.getElementById("txtPip").value || ""
        };

        vscode.postMessage({ type: "image.generateFiles", payload });
    };
  }

    const btnWelcome = document.getElementById("btnWelcome");
    if (btnWelcome) {
    btnWelcome.onclick = () => {
        vscode.postMessage({ type: "navigate", route: "welcome" });
    };
  }
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
      renderEnvCustomizer();
    } catch (e) {
      console.error("Failed to parse preset.data", e);
    }
  }
});

// start
vscode.postMessage({ type: "ready" });
