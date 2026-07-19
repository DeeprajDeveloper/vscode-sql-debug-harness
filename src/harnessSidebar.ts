import * as vscode from "vscode";

/**
 * Empty tree view so the activity-bar container can show viewsWelcome.
 */
class HarnessSidebarProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<vscode.TreeItem[]> {
    return Promise.resolve([]);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

export function registerHarnessSidebar(
  context: vscode.ExtensionContext
): void {
  const provider = new HarnessSidebarProvider();
  const tree = vscode.window.createTreeView("sqlSpHarness.sidebar", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(tree, provider);
}
