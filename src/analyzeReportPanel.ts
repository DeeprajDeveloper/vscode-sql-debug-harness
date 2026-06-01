import * as path from "path";
import * as vscode from "vscode";
import {
  AnalyzeReport,
  parseAnalyzeReport,
} from "./analyzeReportParser";
import { SqlSourceContext } from "./sqlSource";

let activePanel: vscode.WebviewPanel | undefined;
let currentSourceUri: vscode.Uri | undefined;
let currentReportText = "";
let currentFileLabel = "";
let currentSqlSource: SqlSourceContext | undefined;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTable(
  headers: string[],
  rows: string[][],
  emptyMessage: string
): string {
  if (rows.length === 0) {
    return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  }

  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = row.map((c) => `<td>${escapeHtml(c)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderIdentifiedTable(
  report: AnalyzeReport,
  sourceUri?: vscode.Uri
): string {
  if (report.identified.length === 0) {
    return `<p class="empty">No identified statements.</p>`;
  }

  const rows = report.identified
    .map((row) => {
      let detailCell = escapeHtml(row.detail);
      if (sourceUri && row.line !== undefined) {
        detailCell = `<button type="button" class="line-link" data-line="${row.line}">${detailCell}</button>`;
      }
      return `<tr><td>${escapeHtml(row.kind)}</td><td class="detail">${detailCell}</td></tr>`;
    })
    .join("");

  return `<table><thead><tr><th>Kind</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildHtml(
  report: AnalyzeReport,
  fileLabel: string,
  sourceUri?: vscode.Uri
): string {
  const summaryRows = report.summary.map((r) => [r.element, r.count]);
  const warningRows = report.warnings.map((r) => [r.type, r.message]);

  const summaryTable = renderTable(
    ["Element", "Count"],
    summaryRows,
    "No summary data."
  );
  const warningsTable = renderTable(
    ["Type", "Message"],
    warningRows,
    "No warnings or errors."
  );
  const identifiedTable = renderIdentifiedTable(report, sourceUri);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .header {
      margin-bottom: 16px;
    }
    .header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .action-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .action-btn.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .action-btn.secondary:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .header-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    .header h1 {
      margin: 0 0 4px;
      font-size: 1.15em;
      font-weight: 600;
    }
    .header .subtitle {
      opacity: 0.85;
      font-size: 0.9em;
    }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 8px;
    }
    .tab {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
    }
    .tab.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .tab:hover:not(.active) {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .panel { display: none; }
    .panel.active { display: block; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: top;
      word-break: break-word;
    }
    th {
      font-weight: 600;
      background: var(--vscode-editor-inactiveSelectionBackground);
      position: sticky;
      top: 0;
    }
    tr:hover td {
      background: var(--vscode-list-hoverBackground);
    }
    td.detail { font-family: var(--vscode-editor-font-family); font-size: 0.92em; }
    .empty {
      opacity: 0.8;
      font-style: italic;
      margin: 8px 0;
    }
    .line-link {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      padding: 0;
      text-align: left;
      width: 100%;
    }
    .line-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-row">
      <div>
        <h1>Procedure Analysis</h1>
        <div class="subtitle">${escapeHtml(fileLabel)}</div>
      </div>
      <div class="header-actions">
        <button type="button" id="generate-btn" class="action-btn">Generate Debug Script</button>
        <button type="button" id="save-btn" class="action-btn secondary">Save Report</button>
      </div>
    </div>
  </div>
  <div class="tabs">
    <button type="button" class="tab active" data-tab="summary">Summary (${summaryRows.length})</button>
    <button type="button" class="tab" data-tab="warnings">Warnings (${warningRows.length})</button>
    <button type="button" class="tab" data-tab="identified">Identified (${report.identified.length})</button>
  </div>
  <div id="summary" class="panel active">${summaryTable}</div>
  <div id="warnings" class="panel">${warningsTable}</div>
  <div id="identified" class="panel">${identifiedTable}</div>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
      });
    });
    document.querySelectorAll('.line-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        const line = parseInt(btn.dataset.line, 10);
        if (!isNaN(line)) {
          vscode.postMessage({ type: 'gotoLine', line });
        }
      });
    });
    document.getElementById('generate-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'generateDebug' });
    });
    document.getElementById('save-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'saveReport' });
    });
  </script>
</body>
</html>`;
}

async function generateDebugFromAnalysis(): Promise<void> {
  if (!currentSqlSource) {
    vscode.window.showWarningMessage(
      "SQL SP Harness: no analyzed source available for debug script generation."
    );
    return;
  }

  await vscode.commands.executeCommand(
    "spDebug.generateAnalyzed",
    currentSqlSource
  );
}

async function saveReport(
  fileLabel: string,
  reportText: string,
  sourceUri?: vscode.Uri
): Promise<void> {
  const baseName = path.basename(fileLabel, path.extname(fileLabel));
  const defaultName = `${baseName}_analysis.txt`;
  const defaultUri = sourceUri
    ? vscode.Uri.file(path.join(path.dirname(sourceUri.fsPath), defaultName))
    : undefined;

  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "Text Report": ["txt"], "All Files": ["*"] },
    saveLabel: "Save Report",
  });

  if (!target) {
    return;
  }

  await vscode.workspace.fs.writeFile(
    target,
    Buffer.from(`${reportText.trim()}\n`, "utf8")
  );

  const savedDoc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(savedDoc, { preview: true });

  vscode.window.showInformationMessage(
    `Analysis report saved: ${path.basename(target.fsPath)}`
  );
}

async function gotoLine(sourceUri: vscode.Uri, line: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(sourceUri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

export function showAnalyzeReportPanel(
  context: vscode.ExtensionContext,
  fileLabel: string,
  reportText: string,
  sqlSource: SqlSourceContext
): void {
  const report = parseAnalyzeReport(reportText);
  const html = buildHtml(report, fileLabel, sqlSource.sourceUri);
  currentSourceUri = sqlSource.sourceUri;
  currentReportText = reportText;
  currentFileLabel = fileLabel;
  currentSqlSource = sqlSource;

  if (activePanel) {
    activePanel.title = `SP Harness Analysis: ${fileLabel}`;
    activePanel.webview.html = html;
    activePanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  activePanel = vscode.window.createWebviewPanel(
    "sqlSpHarness.analyze",
    `SP Harness Analysis: ${fileLabel}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  activePanel.webview.html = html;

  activePanel.webview.onDidReceiveMessage(async (message: { type: string; line?: number }) => {
    if (message.type === "gotoLine" && currentSourceUri && message.line !== undefined) {
      await gotoLine(currentSourceUri, message.line);
    } else if (message.type === "saveReport") {
      await saveReport(currentFileLabel, currentReportText, currentSourceUri);
    } else if (message.type === "generateDebug") {
      await generateDebugFromAnalysis();
    }
  });

  activePanel.onDidDispose(() => {
    activePanel = undefined;
    currentSourceUri = undefined;
    currentReportText = "";
    currentFileLabel = "";
    currentSqlSource = undefined;
  });

  context.subscriptions.push(activePanel);
}
