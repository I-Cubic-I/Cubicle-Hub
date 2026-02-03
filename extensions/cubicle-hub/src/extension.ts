import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "cubicle-hub" is now active!');

	context.subscriptions.push(
		vscode.commands.registerCommand('cubicleHub.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from cubicle-hub!');
		})
	);
}

export function deactivate() {}
