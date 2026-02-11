// VS Code API
const vscode = acquireVsCodeApi();

// UI 렌더
const root = document.getElementById("root");

function renderWelcome() {
  root.innerHTML = `
    <div style="padding:16px; font-family: sans-serif;">
      <h2>Welcome to Cubicle Hub</h2>
      <p>Agent is optional right now. Default mode is <b>Local Docker Mode</b>.</p>

      <div style="margin-top:12px; display:flex; gap:8px;">
        <button id="btnSkip">Continue (Docker-only)</button>
        <button id="btnInstall">Install Agent (placeholder)</button>
      </div>

      <hr style="margin:16px 0;" />

      <p style="opacity:0.8;">
        You can also open <b>Environment Customizer</b> directly from the Cubicle Hub sidebar.
      </p>
    </div>
  `;

  document.getElementById("btnSkip").onclick = () => {
    vscode.postMessage({ type: "navigate", route: "envCustomizer" });
  };
  document.getElementById("btnInstall").onclick = () => {
    vscode.postMessage({ type: "agent.install.placeholder" });
  };
}

function renderEnvCustomizer() {
  root.innerHTML = `
    <div style="padding:16px; font-family: sans-serif;">
      <h2>Environment Customizer (Local Docker Mode)</h2>
      <p>Create Dockerfile / compose templates. Build is not included at this stage.</p>

      <div style="margin-top:12px;">
        <label>Base Image</label><br/>
        <input id="baseImage" style="width: 520px;" placeholder="e.g., pytorch/pytorch:2.5.0-cuda12.4-cudnn9-runtime" />
      </div>

      <div style="margin-top:12px;">
        <label><input id="makeCompose" type="checkbox" /> Generate docker-compose.yml</label>
      </div>

      <div style="margin-top:12px;">
        <button id="btnGen">Generate Files (placeholder)</button>
        <button id="btnBack" style="margin-left:8px;">Back to Welcome</button>
      </div>
    </div>
  `;

  document.getElementById("btnGen").onclick = () => {
    const payload = {
      baseImage: document.getElementById("baseImage").value,
      makeCompose: document.getElementById("makeCompose").checked,
    };
    vscode.postMessage({ type: "image.generateFiles.placeholder", payload });
  };

  document.getElementById("btnBack").onclick = () => {
    vscode.postMessage({ type: "navigate", route: "welcome" });
  };
}

// 라우팅 처리
function navigate(route) {
  if (route === "welcome") renderWelcome();
  else renderEnvCustomizer();
}

// extension -> webview 메시지 수신
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg?.type === "navigate") {
    navigate(msg.route);
  }
});

// 시작: extension에 ready 알림 (extension이 initial route를 내려주게)
vscode.postMessage({ type: "ready" });
