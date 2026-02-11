import * as vscode from 'vscode';
import { CubiclePanel } from "./panel/CubiclePanel";
import { EnvCustomizerView } from "./views/EnvCustomizerView";

export async function activate(context: vscode.ExtensionContext) {
  // 1) TreeView 등록 (Activity Bar에 보이는 "Image Builder" 한 줄)
  const viewProvider = new EnvCustomizerView(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("cubicleHub.envCustomizerView", viewProvider)
  );

  // 2) 커맨드 등록: Image Builder 열기
  context.subscriptions.push(
    vscode.commands.registerCommand("cubicleHub.openEnvCustomizer", () => {
      CubiclePanel.show(context, "envCustomizer");
    })
  );

  // 3) 첫 실행 시 Welcome 자동 오픈 (딱 1번)
  const hasSeen = context.globalState.get<boolean>("cubicleHub.hasSeenWelcome", false);
  if (!hasSeen) {
    CubiclePanel.show(context, "welcome");
    await context.globalState.update("cubicleHub.hasSeenWelcome", true);
  }
}

export function deactivate() {}