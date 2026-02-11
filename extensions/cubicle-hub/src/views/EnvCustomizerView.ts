import * as vscode from "vscode";

export class EnvCustomizerView implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const item = new vscode.TreeItem("Open Environment Customizer", vscode.TreeItemCollapsibleState.None);
    item.command = { command: "cubicleHub.openEnvCustomizer", title: "Open Environment Customizer" };
    item.iconPath = new vscode.ThemeIcon("tools"); // 임시 아이콘
    return [item];
  }
}
