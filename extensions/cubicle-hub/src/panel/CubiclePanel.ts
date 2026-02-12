import * as vscode from "vscode";

type Route = "welcome" | "envCustomizer";

export class CubiclePanel {
  private static current: CubiclePanel | undefined;

  static show(context: vscode.ExtensionContext, route: Route) {
    if (CubiclePanel.current) {
      CubiclePanel.current.panel.reveal(vscode.ViewColumn.One);
      CubiclePanel.current.navigate(route);
      return;
    }
    CubiclePanel.current = new CubiclePanel(context, route);
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly context: vscode.ExtensionContext, initialRoute: Route) {
    this.panel = vscode.window.createWebviewPanel(
      "cubicleHubMain",
      "Cubicle Hub",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "resources", "webview"),
          vscode.Uri.joinPath(context.extensionUri, "resources", "presets"),
        ],
      }
    );

    this.panel.onDidDispose(() => (CubiclePanel.current = undefined));

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case "ready":
          this.navigate(initialRoute);
          break;

        case "navigate":
          this.navigate(msg.route as Route);
          break;

        case "agent.install.placeholder":
          vscode.window.showInformationMessage("Install Agent (placeholder).");
          break;

        case "image.generateFiles.placeholder":
          vscode.window.showInformationMessage("Generate files (placeholder). Next: implement file writing.");
          break;

        case "preset.load":
          await this.handlePresetLoad();
          break;

        case "image.generateFiles":
          // 아직 파일 생성 안 붙일 거면 일단 로그만
          vscode.window.showInformationMessage("Generate requested (payload received).");
          // TODO: 다음 단계에서 this.handleGenerateFiles(msg.payload)로 파일 생성 구현
          break;
      }
    });

    this.panel.webview.html = this.getHtml();
  }

  private navigate(route: Route) {
    this.panel.webview.postMessage({ type: "navigate", route });
  }

  private getHtml(): string {
    const webview = this.panel.webview;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview", "app.js")
    );

    const nonce = this.getNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join("; ");

    return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cubicle Hub</title>
  </head>
  <body>
    <div id="root"></div>

    <script nonce="${nonce}">
      const el = document.getElementById("root");
      el.innerHTML =
        "<div style='padding:12px;font-family:sans-serif'>" +
        "<div><b>INLINE OK</b></div>" +
        "<div id='inlineTime'></div>" +
        "</div>";
      document.getElementById("inlineTime").textContent =
        "inline at: " + new Date().toISOString();
    </script>

    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;
  }

  private async handlePresetLoad() {
    const presetUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "resources",
      "presets",
      "pytorch_cuda_matrix.json"
    );
    const bytes = await vscode.workspace.fs.readFile(presetUri);
    const text = Buffer.from(bytes).toString("utf-8");
    this.panel.webview.postMessage({ type: "preset.data", text });
  }

  private getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }  
}
