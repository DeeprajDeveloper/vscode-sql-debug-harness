import * as vscode from "vscode";
import {
  clearHistory,
  getHistory,
  historyDidChange,
  type HistoryEntry,
} from "./history";

type NodeKind = "actions" | "action" | "historyRoot" | "historyGroup" | "historyItem";

class SidebarNode extends vscode.TreeItem {
  constructor(
    public readonly kind: NodeKind,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly meta?: {
      commandId?: string;
      entry?: HistoryEntry;
      group?: "analyzed" | "debugged";
    }
  ) {
    super(label, collapsible);
  }
}

class HarnessSidebarProvider implements vscode.TreeDataProvider<SidebarNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SidebarNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    historyDidChange.event(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SidebarNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarNode): Thenable<SidebarNode[]> {
    if (!element) {
      return Promise.resolve([
        new SidebarNode(
          "actions",
          "Actions",
          vscode.TreeItemCollapsibleState.Expanded
        ),
        new SidebarNode(
          "historyRoot",
          "Recent procedures",
          vscode.TreeItemCollapsibleState.Expanded
        ),
      ]);
    }

    if (element.kind === "actions") {
      return Promise.resolve([
        this.actionNode("Open Workbench", "spDebug.openWorkbench", "window"),
        this.actionNode("Analyze Active SQL", "spDebug.analyze", "list-flat"),
        this.actionNode(
          "Generate Debug Script",
          "spDebug.generate",
          "debug-alt"
        ),
      ]);
    }

    if (element.kind === "historyRoot") {
      const entries = getHistory(this.context);
      const analyzed = entries.filter((e) => e.actions.includes("analyzed"));
      const debugged = entries.filter((e) => e.actions.includes("debugged"));
      const nodes: SidebarNode[] = [
        this.groupNode("Analyzed", "analyzed", analyzed.length),
        this.groupNode("Debugged", "debugged", debugged.length),
      ];
      if (entries.length === 0) {
        const empty = new SidebarNode(
          "historyItem",
          "No history yet",
          vscode.TreeItemCollapsibleState.None
        );
        empty.description = "Run Analyze or Generate";
        empty.contextValue = "historyEmpty";
        nodes.push(empty);
      }
      return Promise.resolve(nodes);
    }

    if (element.kind === "historyGroup" && element.meta?.group) {
      const group = element.meta.group;
      const entries = getHistory(this.context).filter((e) =>
        e.actions.includes(group)
      );
      if (entries.length === 0) {
        const empty = new SidebarNode(
          "historyItem",
          "(none)",
          vscode.TreeItemCollapsibleState.None
        );
        empty.contextValue = "historyEmpty";
        return Promise.resolve([empty]);
      }
      return Promise.resolve(entries.map((e) => this.historyItem(e, group)));
    }

    return Promise.resolve([]);
  }

  private actionNode(
    label: string,
    commandId: string,
    icon: string
  ): SidebarNode {
    const node = new SidebarNode(
      "action",
      label,
      vscode.TreeItemCollapsibleState.None,
      { commandId }
    );
    node.iconPath = new vscode.ThemeIcon(icon);
    node.command = { command: commandId, title: label };
    node.contextValue = "harnessAction";
    return node;
  }

  private groupNode(
    label: string,
    group: "analyzed" | "debugged",
    count: number
  ): SidebarNode {
    const node = new SidebarNode(
      "historyGroup",
      label,
      count > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      { group }
    );
    node.description = String(count);
    node.iconPath = new vscode.ThemeIcon(
      group === "analyzed" ? "list-flat" : "debug-alt"
    );
    node.contextValue = "historyGroup";
    return node;
  }

  private historyItem(
    entry: HistoryEntry,
    group: "analyzed" | "debugged"
  ): SidebarNode {
    const node = new SidebarNode(
      "historyItem",
      entry.label,
      vscode.TreeItemCollapsibleState.None,
      { entry, group }
    );
    node.description = group;
    node.tooltip = entry.fsPath ?? entry.label;
    node.iconPath = new vscode.ThemeIcon("file-code");
    node.contextValue = entry.uri ? "historyFile" : "historyUntitled";
    if (entry.uri) {
      node.command = {
        command: "spDebug.openHistoryItem",
        title: "Open in Workbench",
        arguments: [entry.uri],
      };
    }
    return node;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

let treeView: vscode.TreeView<SidebarNode> | undefined;

export function registerHarnessSidebar(
  context: vscode.ExtensionContext
): void {
  const provider = new HarnessSidebarProvider(context);
  treeView = vscode.window.createTreeView("sqlSpHarness.sidebar", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(
    treeView,
    provider,
    vscode.commands.registerCommand("spDebug.clearHistory", () => {
      clearHistory(context);
      vscode.window.showInformationMessage("SQL Debug Harness: history cleared.");
    }),
    vscode.commands.registerCommand(
      "spDebug.openHistoryItem",
      async (uriString: string) => {
        try {
          const uri = vscode.Uri.parse(uriString);
          await vscode.commands.executeCommand("spDebug.openInWorkbench", uri);
        } catch {
          vscode.window.showWarningMessage(
            "SQL Debug Harness: could not open that history item."
          );
        }
      }
    ),
    vscode.commands.registerCommand("spDebug.toggleSidebar", () =>
      toggleHarnessSidebar()
    ),
    vscode.commands.registerCommand("spDebug.showHistory", () =>
      showHarnessHistory(context)
    )
  );
}

/** Toggle the SQL Debug Harness activity-bar sidebar. */
export async function toggleHarnessSidebar(): Promise<void> {
  if (treeView?.visible) {
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    return;
  }
  await vscode.commands.executeCommand(
    "workbench.view.extension.sql-debug-harness"
  );
}

/** Pick a recent procedure from history (does not open the sidebar). */
export async function showHarnessHistory(
  context: vscode.ExtensionContext
): Promise<void> {
  const entries = getHistory(context);

  if (entries.length === 0) {
    vscode.window.showInformationMessage(
      "SQL Debug Harness: no history yet — Analyze or Generate a procedure first."
    );
    return;
  }

  type HistoryPick = vscode.QuickPickItem & { uri?: string };
  const items: HistoryPick[] = entries.map((e) => {
    const actions = e.actions
      .filter((a) => a === "analyzed" || a === "debugged")
      .join(" · ");
    return {
      label: e.label,
      description: actions || e.lastAction,
      detail: e.fsPath,
      uri: e.uri,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: "SQL Debug Harness — Recent procedures",
    placeHolder: "Select a procedure to open in the workbench",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked?.uri) {
    return;
  }
  await vscode.commands.executeCommand("spDebug.openHistoryItem", picked.uri);
}
