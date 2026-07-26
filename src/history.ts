import * as vscode from "vscode";

const HISTORY_KEY = "sqlSpHarness.history";
const MAX_HISTORY = 25;

export type HistoryAction = "analyzed" | "debugged" | "opened";

export type HistoryEntry = {
  /** Absolute file path or untitled label key */
  id: string;
  label: string;
  fsPath?: string;
  uri?: string;
  lastAction: HistoryAction;
  /** Actions seen for this file (most recent last) */
  actions: HistoryAction[];
  updatedAt: number;
};

function loadRaw(context: vscode.ExtensionContext): HistoryEntry[] {
  const raw = context.workspaceState.get<HistoryEntry[]>(HISTORY_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function save(context: vscode.ExtensionContext, entries: HistoryEntry[]): void {
  void context.workspaceState.update(HISTORY_KEY, entries.slice(0, MAX_HISTORY));
}

export function getHistory(context: vscode.ExtensionContext): HistoryEntry[] {
  return loadRaw(context).slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function recordHistory(
  context: vscode.ExtensionContext,
  opts: {
    label: string;
    uri?: vscode.Uri;
    action: HistoryAction;
  }
): void {
  const id = opts.uri?.toString() ?? `label:${opts.label}`;
  const entries = loadRaw(context);
  const existing = entries.find((e) => e.id === id);
  const actions = existing
    ? existing.actions.filter((a) => a !== opts.action).concat(opts.action)
    : [opts.action];
  const next: HistoryEntry = {
    id,
    label: opts.label,
    fsPath: opts.uri?.fsPath,
    uri: opts.uri?.toString(),
    lastAction: opts.action,
    actions,
    updatedAt: Date.now(),
  };
  const rest = entries.filter((e) => e.id !== id);
  save(context, [next, ...rest]);
  historyDidChange.fire();
}

export function clearHistory(context: vscode.ExtensionContext): void {
  void context.workspaceState.update(HISTORY_KEY, []);
  historyDidChange.fire();
}

export const historyDidChange = new vscode.EventEmitter<void>();
