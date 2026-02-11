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

    const csp = `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';`;

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
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
