import * as vscode from "vscode";
import { analyze, generate } from "./engine";
import {
  showHarnessWorkbench,
  openEmptyWorkbench,
  writeStepLogBesideSource,
  loadSqlFileIntoWorkbench,
} from "./harnessWorkbench";
import { SqlSourceContext } from "./sqlSource";
import { getSpDebugSettings } from "./settings";
import {
  configureSettingsInteractive,
  openExtensionSettings,
} from "./configureSettings";
import { registerHarnessSidebar } from "./harnessSidebar";
import { recordHistory } from "./history";

const OUTPUT_CHANNEL = "SQL SP Harness";

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  }
  return outputChannel;
}

function appendStepLog(
  channel: vscode.OutputChannel,
  label: string,
  stepLog: string[]
): void {
  if (!stepLog.length) {
    channel.appendLine("(No step log was produced.)");
    return;
  }
  channel.appendLine("");
  channel.appendLine(`--- Step log (${label}) ---`);
  for (const line of stepLog) {
    channel.appendLine(line);
  }
  channel.appendLine("--- End step log ---");
}

async function resolveSqlSource(
  uri?: vscode.Uri
): Promise<SqlSourceContext | null> {
  if (uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (pathExt(uri.fsPath).toLowerCase() !== ".sql") {
      vscode.window.showWarningMessage("SQL SP Harness: file is not a .sql file.");
      return null;
    }
    const baseName = basename(uri.fsPath, pathExt(uri.fsPath));
    return {
      source: doc.getText(),
      baseName,
      label: basename(uri.fsPath),
      sourceUri: uri,
    };
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("SQL SP Harness: open a .sql file first.");
    return null;
  }
  if (editor.document.languageId !== "sql") {
    vscode.window.showWarningMessage("SQL SP Harness: active file is not SQL.");
    return null;
  }

  const doc = editor.document;
  const selection = editor.selection;
  const source = selection.isEmpty ? doc.getText() : doc.getText(selection);
  const filePath = doc.uri.fsPath;
  const baseName = filePath
    ? basename(filePath, pathExt(filePath))
    : "script";
  const label = filePath ? basename(filePath) : "untitled.sql";
  const sourceUri = filePath ? doc.uri : undefined;
  return { source, baseName, label, sourceUri };
}

function pathExt(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i) : "";
}

function basename(p: string, ext?: string): string {
  const name = p.replace(/^.*[/\\]/, "");
  if (ext && name.toLowerCase().endsWith(ext.toLowerCase())) {
    return name.slice(0, -ext.length);
  }
  return name;
}

async function openWorkbench(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri
): Promise<void> {
  if (uri) {
    const resolved = await resolveSqlSource(uri);
    if (!resolved) {
      return;
    }
    showHarnessWorkbench(context, resolved);
    if (resolved.sourceUri || resolved.label) {
      recordHistory(context, {
        label: resolved.label,
        uri: resolved.sourceUri,
        action: "opened",
      });
    }
    return;
  }

  // Prefer active SQL editor/selection when available; otherwise open empty workbench.
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === "sql") {
    const resolved = await resolveSqlSource();
    if (resolved) {
      showHarnessWorkbench(context, resolved);
      recordHistory(context, {
        label: resolved.label,
        uri: resolved.sourceUri,
        action: "opened",
      });
      return;
    }
  }

  openEmptyWorkbench(context);
}

async function generateDebugScript(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  sqlSource?: SqlSourceContext
): Promise<void> {
  const resolved = sqlSource ?? (await resolveSqlSource(uri));
  if (!resolved) {
    return;
  }

  const { traceStyle, logToOutput, saveLogFile, quietWhenLogging } =
    getSpDebugSettings();
  const channel = getOutputChannel();
  if (logToOutput || !quietWhenLogging) {
    channel.show(true);
    channel.appendLine(`[${resolved.label}] Generating debug script...`);
  }

  const result = generate(resolved.source, {
    traceStyle,
    onProgress: (msg) => {
      if (!quietWhenLogging) {
        channel.appendLine(msg);
      }
    },
  });

  if (logToOutput) {
    appendStepLog(channel, resolved.label, result.stepLog);
  }
  if (saveLogFile && resolved.sourceUri) {
    const logPath = writeStepLogBesideSource(
      result.stepLog,
      resolved.sourceUri,
      resolved.baseName
    );
    channel.appendLine(`Saved step log: ${logPath}`);
  }

  showHarnessWorkbench(context, resolved, {
    debugSql: result.sql,
    stepLog: result.stepLog,
  });
  recordHistory(context, {
    label: resolved.label,
    uri: resolved.sourceUri,
    action: "debugged",
  });

  const hasWarnings =
    result.stats.warnings.length > 0 || result.parseErrors.length > 0;
  if (hasWarnings) {
    vscode.window.showWarningMessage(
      "SQL SP Harness: completed with warnings — review the workbench Analysis / Active log."
    );
  } else {
    vscode.window.showInformationMessage(
      `SQL SP Harness: debug script ready for ${resolved.label}.`
    );
  }
}

async function runAnalyze(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri
): Promise<void> {
  const resolved = await resolveSqlSource(uri);
  if (!resolved) {
    return;
  }

  const { logToOutput, saveLogFile } = getSpDebugSettings();
  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine(`[${resolved.label}] Analyzing...`);

  const report = analyze(resolved.source);

  if (logToOutput) {
    appendStepLog(channel, resolved.label, report.stepLog);
  }
  if (saveLogFile && resolved.sourceUri) {
    const logPath = writeStepLogBesideSource(
      report.stepLog,
      resolved.sourceUri,
      resolved.baseName
    );
    channel.appendLine(`Saved step log: ${logPath}`);
  }

  channel.appendLine(report.plainText);

  showHarnessWorkbench(context, resolved, {
    report,
    stepLog: report.stepLog,
  });
  recordHistory(context, {
    label: resolved.label,
    uri: resolved.sourceUri,
    action: "analyzed",
  });

  const realWarnings = report.warnings.filter(
    (w) => w.type !== "—" && w.message !== "None"
  );
  if (realWarnings.length > 0) {
    vscode.window.showWarningMessage(
      `SQL SP Harness: ${realWarnings.length} warning(s) — see workbench Analysis › Warnings.`
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  channel.appendLine(
    "SQL SP Harness ready (in-process TypeScript engine — no Python required)."
  );

  registerHarnessSidebar(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("spDebug.generate", (uri?: vscode.Uri) =>
      generateDebugScript(context, uri)
    ),
    vscode.commands.registerCommand(
      "spDebug.generateAnalyzed",
      (sqlSource: SqlSourceContext) =>
        generateDebugScript(context, sqlSource.sourceUri, sqlSource)
    ),
    vscode.commands.registerCommand("spDebug.analyze", (uri?: vscode.Uri) =>
      runAnalyze(context, uri)
    ),
    vscode.commands.registerCommand("spDebug.openWorkbench", (uri?: vscode.Uri) =>
      openWorkbench(context, uri)
    ),
    vscode.commands.registerCommand(
      "spDebug.openInWorkbench",
      async (uri?: vscode.Uri) => {
        const target =
          uri ??
          vscode.window.activeTextEditor?.document.uri;
        if (!target || pathExt(target.fsPath).toLowerCase() !== ".sql") {
          vscode.window.showWarningMessage(
            "SQL SP Harness: select a .sql file to open in the workbench."
          );
          return;
        }
        await loadSqlFileIntoWorkbench(context, target);
      }
    ),
    vscode.commands.registerCommand("spDebug.configure", () =>
      configureSettingsInteractive()
    ),
    vscode.commands.registerCommand("spDebug.openSettings", () =>
      openExtensionSettings()
    )
  );
}

export function deactivate(): void {}
