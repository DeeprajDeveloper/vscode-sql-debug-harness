import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { analyze, generate, type AnalyzeReport } from "./engine";
import type { SqlSourceContext } from "./sqlSource";
import { getSpDebugSettings } from "./settings";
import { highlightTsql } from "./sqlHighlight";

export type WorkbenchState = {
  source?: SqlSourceContext;
  report?: AnalyzeReport;
  debugSql?: string;
  stepLog: string[];
  lastAction?: "analyze" | "generate";
};

let panel: vscode.WebviewPanel | undefined;
let state: WorkbenchState | undefined;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Syntax-highlighted SQL with a gutter of line numbers. */
function renderSqlPreview(sql: string): string {
  const lines = sql.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = lines
    .map((line, i) => {
      const highlighted = highlightTsql(line);
      return `<div class="code-line"><span class="ln" aria-hidden="true">${i + 1}</span><code class="lc">${highlighted || "&nbsp;"}</code></div>`;
    })
    .join("");
  return `<div class="sql code-preview" role="region">${rows}</div>`;
}

function emptySource(): SqlSourceContext {
  return {
    source: "",
    baseName: "untitled",
    label: "[ no file selected ]",
  };
}

function realWarnings(report: AnalyzeReport) {
  return report.warnings.filter(
    (w) => w.type !== "—" && w.message !== "None"
  );
}

function hasSource(s: WorkbenchState): boolean {
  return Boolean(s.source && s.source.source.trim().length > 0);
}

function renderAnalysisPanel(report: AnalyzeReport | undefined): string {
  if (!report) {
    return `
      <div class="analysis-tabs" role="tablist">
        <button type="button" class="tab-btn active" data-tab="summary" disabled>View Summary</button>
        <button type="button" class="tab-btn" data-tab="warnings" disabled>See Warnings</button>
        <button type="button" class="tab-btn" data-tab="identified" disabled>Data Identified</button>
      </div>
      <div class="tab-panels">
        <p class="empty">Run <strong>Analyze Script</strong> to populate Summary, Warnings, and Identified.</p>
      </div>`;
  }

  const warnings = realWarnings(report);
  const defaultTab = warnings.length > 0 ? "warnings" : "summary";

  const summaryRows = report.summary
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.element)}</td><td class="num">${escapeHtml(r.count)}</td></tr>`
    )
    .join("");

  const warningRows =
    warnings.length === 0
      ? `<tr><td colspan="2" class="empty-cell">No warnings or errors found.</td></tr>`
      : warnings
          .map(
            (w) =>
              `<tr class="${w.type === "Error" ? "row-error" : "row-warning"}"><td>${escapeHtml(w.type)}</td><td>${escapeHtml(w.message)}</td></tr>`
          )
          .join("");

  const identifiedRows =
    report.identified.length === 0
      ? `<tr><td colspan="2" class="empty-cell">No identifiable data or statements found.</td></tr>`
      : report.identified
          .map((row) => {
            const detail =
              row.line !== undefined
                ? `<button type="button" class="line-link" data-line="${row.line}">${escapeHtml(row.detail)}</button>`
                : escapeHtml(row.detail);
            return `<tr><td>${escapeHtml(row.kind)}</td><td class="detail">${detail}</td></tr>`;
          })
          .join("");

  const banner =
    warnings.length > 0
      ? `<div class="warning-banner" role="alert"><strong>${warnings.length} review item(s)</strong> — check the Warnings tab before running the debug script.</div>`
      : "";

  return `
    ${banner}
    <div class="analysis-tabs" role="tablist" data-default-tab="${defaultTab}">
      <button type="button" class="tab-btn" role="tab" data-tab="summary" aria-selected="false">
        Summary <span class="badge">${report.summary.length}</span>
      </button>
      <button type="button" class="tab-btn" role="tab" data-tab="warnings" aria-selected="false">
        Warnings <span class="badge ${warnings.length ? "warn" : ""}">${warnings.length}</span>
      </button>
      <button type="button" class="tab-btn" role="tab" data-tab="identified" aria-selected="false">
        Identified <span class="badge">${report.identified.length}</span>
      </button>
    </div>
    <div class="tab-panels">
      <div class="tab-panel" data-panel="summary" hidden>
        <table><thead><tr><th>Element</th><th>Count</th></tr></thead><tbody>${summaryRows}</tbody></table>
      </div>
      <div class="tab-panel" data-panel="warnings" hidden>
        <table><thead><tr><th>Type</th><th>Message</th></tr></thead><tbody>${warningRows}</tbody></table>
      </div>
      <div class="tab-panel" data-panel="identified" hidden>
        <table><thead><tr><th>Kind</th><th>Detail</th></tr></thead><tbody>${identifiedRows}</tbody></table>
      </div>
    </div>`;
}

function buildHtml(s: WorkbenchState): string {
  const src = s.source ?? emptySource();
  const label = escapeHtml(src.label);
  const loaded = hasSource(s);
  const sourceSqlHtml = loaded ? renderSqlPreview(src.source) : "";
  const debugSqlHtml = s.debugSql ? renderSqlPreview(s.debugSql) : "";
  const hasAnalysis = Boolean(s.report);
  const hasDebug = Boolean(s.debugSql);
  const hasLog = s.stepLog.length > 0;
  const analysisHtml = renderAnalysisPanel(s.report);
  const logText = hasLog ? escapeHtml(s.stepLog.join("\n")) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    :root {
      --gap: 0px;
      --radius: 4px;
      --splitter: 5px;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(127,127,127,0.35)));
      --pane-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --header-bg: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBarSectionHeader-background, transparent));
      --code-bg: var(--vscode-textCodeBlock-background, var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,0.12)));
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground, var(--vscode-button-background));
      --btn2-bg: var(--vscode-button-secondaryBackground);
      --btn2-fg: var(--vscode-button-secondaryForeground);
      --btn2-hover: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, var(--border));
      --focus: var(--vscode-focusBorder);
      --link: var(--vscode-textLink-foreground);
      --warn-bg: var(--vscode-inputValidation-warningBackground, rgba(255,166,0,0.18));
      --warn-fg: var(--vscode-inputValidation-warningForeground, var(--fg));
      --warn-bd: var(--vscode-inputValidation-warningBorder, #cca700);
      --err-bg: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.14));
      --list-hover: var(--vscode-list-hoverBackground);
      --sash: var(--vscode-sash-hoverBorder, var(--focus));
      --font: var(--vscode-font-family);
      --mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      --fs: var(--vscode-font-size);
      --efs: var(--vscode-editor-font-size, var(--fs));
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--font);
      font-size: var(--fs);
      color: var(--fg);
      background: var(--bg);
      padding: 10px;
      gap: 8px;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--pane-bg);
    }
    .toolbar-left, .toolbar-right { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .file-label {
      font-weight: 600;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .btn {
      border: 1px solid transparent;
      border-radius: var(--radius);
      padding: 5px 11px;
      cursor: pointer;
      font: inherit;
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    .btn:hover:not(:disabled) { background: var(--btn-hover); }
    .btn:focus-visible { outline: 1px solid var(--focus); outline-offset: 1px; }
    .btn.secondary {
      background: var(--btn2-bg);
      color: var(--btn2-fg);
    }
    .btn.secondary:hover:not(:disabled) { background: var(--btn2-hover); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .status { font-size: 0.85em; color: var(--muted); }

    .workspace {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--bg);
    }

    .row-top {
      display: flex;
      flex-direction: row;
      min-height: 72px;
      overflow: hidden;
    }
    .row-analysis {
      display: flex;
      flex-direction: column;
      min-height: 72px;
      overflow: hidden;
    }
    .row-log {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 72px;
      overflow: hidden;
    }

    .pane {
      display: flex;
      flex-direction: column;
      min-width: 120px;
      min-height: 0;
      background: var(--pane-bg);
      overflow: hidden;
    }
    .pane.source, .pane.debug { flex: 1 1 0; min-width: 25%; }
    .pane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--border);
      background: var(--header-bg);
      font-weight: 600;
      flex-shrink: 0;
    }
    .pane-body {
      flex: 1;
      overflow: auto;
      padding: 8px 10px;
      min-height: 0;
      background: var(--bg);
    }

    .v-split, .h-split {
      flex-shrink: 0;
      background: var(--border);
      position: relative;
      z-index: 5;
    }
    .v-split {
      width: var(--splitter);
      cursor: col-resize;
    }
    .h-split {
      height: var(--splitter);
      width: 100%;
      cursor: row-resize;
    }
    .v-split:hover, .h-split:hover,
    .v-split.active, .h-split.active {
      background: var(--sash);
    }
    .h-split.hidden { display: none !important; }
    .row-collapsed > .pane > .pane-body { display: none !important; }
    .row-collapsed {
      flex: 0 0 auto !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
    }
    .workspace-dock {
      display: flex;
      flex-direction: column;
      flex: 0 0 auto;
      border-top: 1px solid var(--border);
      background: var(--pane-bg);
    }
    .workspace-dock:empty { display: none; }
    .dock-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      cursor: pointer;
      background: var(--header-bg);
    }
    .dock-item:last-child { border-bottom: none; }
    .dock-item:hover { background: var(--list-hover); }
    .dock-item .dock-hint { font-weight: 400; color: var(--muted); font-size: 0.85em; }

    .collapse-btn {
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      padding: 2px 6px;
      border-radius: var(--radius);
      line-height: 1;
    }
    .collapse-btn:hover { background: var(--list-hover); color: var(--fg); }
    .collapse-btn:focus-visible { outline: 1px solid var(--focus); }

    .analysis-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .tab-btn {
      border: 1px solid var(--border);
      background: var(--btn2-bg);
      color: var(--btn2-fg);
      border-radius: var(--radius);
      padding: 5px 10px;
      cursor: pointer;
      font: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tab-btn:hover:not(:disabled) { background: var(--btn2-hover); }
    .tab-btn.active {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border-color: transparent;
    }
    .tab-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .tab-btn .badge {
      font-size: 0.8em;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--code-bg);
      color: var(--fg);
    }
    .tab-btn.active .badge { background: rgba(255,255,255,0.18); color: inherit; }
    .tab-btn .badge.warn {
      background: var(--warn-bg);
      color: var(--warn-fg);
      outline: 1px solid var(--warn-bd);
    }
    .tab-panels { min-height: 0; }
    .tab-panel table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .tab-panel th, .tab-panel td {
      text-align: left;
      padding: 6px 10px;
      border-top: 1px solid var(--border);
      vertical-align: top;
      word-break: break-word;
      color: var(--fg);
    }
    .tab-panel th {
      font-weight: 600;
      background: var(--vscode-editor-inactiveSelectionBackground, var(--code-bg));
    }

    pre.sql, pre.log {
      margin: 0;
      font-family: var(--mono);
      font-size: var(--efs);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
      color: var(--fg);
    }
    pre.log {
      background: var(--code-bg);
      padding: 8px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }
    .code-preview {
      margin: 0;
      font-family: var(--mono);
      font-size: var(--efs);
      line-height: 1.45;
      color: var(--fg);
      background: var(--code-bg);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      overflow: auto;
    }
    .code-line {
      display: flex;
      align-items: flex-start;
      min-height: 1.45em;
    }
    .code-line:hover { background: var(--list-hover); }
    .code-line .ln {
      flex: 0 0 auto;
      min-width: 3.25em;
      padding: 0 8px 0 10px;
      text-align: right;
      color: var(--muted);
      user-select: none;
      border-right: 1px solid var(--border);
      background: var(--pane-bg);
      opacity: 0.85;
    }
    .code-line .lc {
      flex: 1;
      min-width: 0;
      padding: 0 10px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      font-size: inherit;
      background: transparent;
    }
    .tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-charts-purple, #c586c0)); font-weight: 600; }
    .tok-type { color: var(--vscode-symbolIcon-typeParameterForeground, var(--vscode-charts-blue, #4ec9b0)); }
    .tok-string { color: var(--vscode-debugTokenExpression-string, var(--vscode-charts-orange, #ce9178)); }
    .tok-comment { color: var(--vscode-descriptionForeground, #6a9955); font-style: italic; }
    .tok-number { color: var(--vscode-debugTokenExpression-number, var(--vscode-charts-yellow, #b5cea8)); }
    .tok-var { color: var(--vscode-debugTokenExpression-name, var(--vscode-charts-blue, #9cdcfe)); }
    .tok-ident { color: var(--fg); }
    .empty, .pane-empty { color: var(--muted); font-style: italic; margin: 8px 0; }
    .empty-hint {
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      padding: 16px;
      text-align: center;
      color: var(--muted);
      background: var(--code-bg);
    }
    .empty-hint strong { color: var(--fg); font-style: normal; }
    td.num { width: 72px; }
    td.detail { font-family: var(--mono); font-size: 0.92em; }
    tr.row-warning td { background: var(--warn-bg); color: var(--warn-fg); }
    tr.row-error td { background: var(--err-bg); }
    .empty-cell { color: var(--muted); font-style: italic; }
    .warning-banner {
      background: #f5e6a3;
      color: #5c4800;
      border: 1px solid #c9a227;
      border-radius: var(--radius);
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .warning-banner strong { color: #3d3000; }
    .line-link {
      background: none; border: none; padding: 0; margin: 0;
      color: var(--link);
      cursor: pointer; font: inherit; text-align: left; width: 100%;
    }
    .line-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="file-label" title="${label}">${label}</span>
      <button type="button" class="btn secondary" id="btn-browse" title="Select a .sql file from the workspace">Select File …</button>
      <button type="button" class="btn secondary" id="btn-load-active" title="Load the active SQL editor">Load Active SQL</button>
      <button type="button" class="btn" id="btn-analyze" ${loaded ? "" : "disabled"}>Analyze Script</button>
      <button type="button" class="btn" id="btn-generate" ${loaded ? "" : "disabled"}>Generate Debug Script</button>
    </div>
    <div class="toolbar-right">
      <span class="status">Saving Options:</span>
      <button type="button" class="btn secondary" id="btn-save-analysis" ${hasAnalysis ? "" : "disabled"}>Analysis Report</button>
      <button type="button" class="btn secondary" id="btn-save-debug" ${hasDebug ? "" : "disabled"}>Debug Script</button>
      <button type="button" class="btn secondary" id="btn-save-log" ${hasLog ? "" : "disabled"}>Log File</button>
      <button type="button" class="btn secondary" id="btn-open-debug" ${hasDebug ? "" : "disabled"}>Open Debug Script</button>
    </div>
  </div>

  <div class="workspace" id="workspace">
    <div class="row-top" id="row-top">
      <section class="pane source" id="pane-source">
        <div class="pane-header"><span>Source</span><span class="status">${loaded ? "file / selection" : "empty — select a .sql file"}</span></div>
        <div class="pane-body" id="source-body">
          ${
            loaded
              ? sourceSqlHtml
              : `<div class="empty-hint"><strong>No SQL loaded. </strong><br><strong>Select File…</strong> from the workspace, or <strong>Load Active SQL file</strong> from the open editor</div>`
          }
        </div>
      </section>
      <div class="v-split" id="split-source-debug" title="Drag to resize"></div>
      <section class="pane debug" id="pane-debug">
        <div class="pane-header"><span>Generated Debug Script</span><span class="status">${hasDebug ? "generated" : "not generated"}</span></div>
        <div class="pane-body">
          ${
            hasDebug
              ? debugSqlHtml
              : `<p class="empty pane-empty">Click on <strong>Generate Debug Script</strong> button to produce a debug harness script here.</p>`
          }
        </div>
      </section>
    </div>

    <div class="h-split" id="split-top-analysis" title="Drag to resize"></div>

    <div class="row-analysis" id="row-analysis">
      <section class="pane" style="flex:1">
        <div class="pane-header">
          <span>Analysis Report</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span class="status">use tabs below</span>
            <button type="button" class="collapse-btn" id="btn-collapse-analysis" title="Collapse or expand Analysis" aria-expanded="true">▾</button>
          </span>
        </div>
        <div class="pane-body" id="analysis-body">${analysisHtml}</div>
      </section>
    </div>

    <div class="h-split" id="split-analysis-log" title="Drag to resize"></div>

    <div class="row-log" id="row-log">
      <section class="pane" style="flex:1">
        <div class="pane-header">
          <span>Activity Log (Steps)</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span class="status">${s.stepLog.length} line(s)</span>
            <button type="button" class="collapse-btn" id="btn-collapse-log" title="Collapse or expand Active log" aria-expanded="true">▾</button>
          </span>
        </div>
        <div class="pane-body" id="log-body">
          ${
            hasLog
              ? `<pre class="log">${logText}</pre>`
              : `<p class="empty pane-empty">Step log appears here after Analyze or Generate.</p>`
          }
        </div>
      </section>
    </div>

    <div class="workspace-dock" id="workspace-dock" aria-label="Collapsed panels"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const saved = vscode.getState() || {};

    function post(type, extra) {
      vscode.postMessage(Object.assign({ type }, extra || {}));
    }

    document.getElementById('btn-browse').addEventListener('click', () => post('browse'));
    document.getElementById('btn-load-active').addEventListener('click', () => post('loadActive'));
    document.getElementById('btn-analyze').addEventListener('click', () => post('analyze'));
    document.getElementById('btn-generate').addEventListener('click', () => post('generate'));
    document.getElementById('btn-save-analysis').addEventListener('click', () => post('saveAnalysis'));
    document.getElementById('btn-save-debug').addEventListener('click', () => post('saveDebug'));
    document.getElementById('btn-save-log').addEventListener('click', () => post('saveLog'));
    document.getElementById('btn-open-debug').addEventListener('click', () => post('openDebug'));
    document.querySelectorAll('.line-link').forEach((btn) => {
      btn.addEventListener('click', () => {
        const line = parseInt(btn.dataset.line, 10);
        if (!isNaN(line)) post('gotoLine', { line });
      });
    });

    /* ---- analysis tabs ---- */
    (function initAnalysisTabs() {
      const tablist = document.querySelector('.analysis-tabs');
      if (!tablist) return;
      const buttons = Array.from(tablist.querySelectorAll('.tab-btn'));
      const panels = Array.from(document.querySelectorAll('.tab-panel'));
      if (!panels.length) return;

      function activate(tab) {
        buttons.forEach((b) => {
          const on = b.dataset.tab === tab;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        panels.forEach((p) => {
          p.hidden = p.dataset.panel !== tab;
        });
        const st = vscode.getState() || {};
        st.analysisTab = tab;
        vscode.setState(st);
      }

      buttons.forEach((b) => {
        b.addEventListener('click', () => {
          if (!b.disabled) activate(b.dataset.tab);
        });
      });

      const st = vscode.getState() || {};
      const preferred = st.analysisTab || tablist.getAttribute('data-default-tab') || 'summary';
      const valid = buttons.some((b) => b.dataset.tab === preferred && !b.disabled);
      activate(valid ? preferred : (buttons.find((b) => !b.disabled) || buttons[0]).dataset.tab);
    })();

    /* ---- resizable splits (clamped; collapsed panels dock to bottom) ---- */
    const workspace = document.getElementById('workspace');
    const rowTop = document.getElementById('row-top');
    const rowAnalysis = document.getElementById('row-analysis');
    const rowLog = document.getElementById('row-log');
    const paneSource = document.getElementById('pane-source');
    const paneDebug = document.getElementById('pane-debug');
    const splitTopAnalysis = document.getElementById('split-top-analysis');
    const splitAnalysisLog = document.getElementById('split-analysis-log');
    const btnCollapseAnalysis = document.getElementById('btn-collapse-analysis');
    const btnCollapseLog = document.getElementById('btn-collapse-log');
    const dock = document.getElementById('workspace-dock');
    const SPLIT = 5;
    const MIN_ROW = 72;
    const HEADER_H = 36;
    const DEFAULT_SQL_RATIO = 0.42;
    const DEFAULT_ANALYSIS_RATIO = 0.33;

    let analysisCollapsed = saved.analysisCollapsed === true;
    let logCollapsed = saved.logCollapsed === true;

    function clamp(n, lo, hi) {
      return Math.max(lo, Math.min(hi, n));
    }

    function workspaceInnerHeight() {
      return Math.max(MIN_ROW + HEADER_H * 2 + SPLIT * 2, workspace.clientHeight);
    }

    function minColWidth() {
      return Math.max(80, Math.floor(rowTop.clientWidth * 0.25));
    }

    function defaultHeights() {
      const total = workspaceInnerHeight();
      let splits = 0;
      if (!analysisCollapsed || !logCollapsed) splits += 1;
      if (!analysisCollapsed && !logCollapsed) splits += 1;
      const dockH = (analysisCollapsed ? HEADER_H : 0) + (logCollapsed ? HEADER_H : 0);
      const usable = Math.max(MIN_ROW, total - splits * SPLIT - dockH);
      return {
        sql: Math.round(usable * DEFAULT_SQL_RATIO),
        analysis: Math.round(usable * DEFAULT_ANALYSIS_RATIO),
        usable,
        dockH,
        splits,
      };
    }

    function persistLayout() {
      const st = vscode.getState() || {};
      st.sourceWidthPct = rowTop.clientWidth
        ? paneSource.getBoundingClientRect().width / rowTop.clientWidth
        : 0.5;
      st.sqlHeightPct = workspaceInnerHeight()
        ? rowTop.getBoundingClientRect().height / workspaceInnerHeight()
        : DEFAULT_SQL_RATIO;
      st.analysisCollapsed = analysisCollapsed;
      st.logCollapsed = logCollapsed;
      vscode.setState(st);
    }

    function rebuildDock() {
      dock.innerHTML = '';
      if (analysisCollapsed) {
        const item = document.createElement('div');
        item.className = 'dock-item';
        item.innerHTML = '<span>Analysis</span><span class="dock-hint">Click to expand</span>';
        item.addEventListener('click', () => toggleCollapse('analysis'));
        dock.appendChild(item);
      }
      if (logCollapsed) {
        const item = document.createElement('div');
        item.className = 'dock-item';
        item.innerHTML = '<span>Active log</span><span class="dock-hint">Click to expand</span>';
        item.addEventListener('click', () => toggleCollapse('log'));
        dock.appendChild(item);
      }
    }

    function applyCollapseUi() {
      rowAnalysis.classList.toggle('row-collapsed', analysisCollapsed);
      rowLog.classList.toggle('row-collapsed', logCollapsed);
      rowAnalysis.style.display = analysisCollapsed ? 'none' : 'flex';
      rowLog.style.display = logCollapsed ? 'none' : 'flex';

      // Splitters: sql↔next expanded; analysis↔log only if both expanded
      const anyExpanded = !analysisCollapsed || !logCollapsed;
      splitTopAnalysis.classList.toggle('hidden', !anyExpanded);
      splitAnalysisLog.classList.toggle('hidden', analysisCollapsed || logCollapsed);

      btnCollapseAnalysis.textContent = analysisCollapsed ? '▸' : '▾';
      btnCollapseAnalysis.setAttribute('aria-expanded', analysisCollapsed ? 'false' : 'true');
      btnCollapseAnalysis.title = analysisCollapsed ? 'Expand Analysis' : 'Collapse Analysis';
      btnCollapseLog.textContent = logCollapsed ? '▸' : '▾';
      btnCollapseLog.setAttribute('aria-expanded', logCollapsed ? 'false' : 'true');
      btnCollapseLog.title = logCollapsed ? 'Expand Active log' : 'Collapse Active log';

      rebuildDock();
    }

    function applyLayout(sqlH, analysisH) {
      applyCollapseUi();
      const defs = defaultHeights();
      const total = workspaceInnerHeight();
      const dockH = defs.dockH;
      let splits = 0;
      if (!analysisCollapsed || !logCollapsed) splits += 1;
      if (!analysisCollapsed && !logCollapsed) splits += 1;
      const available = total - splits * SPLIT - dockH;

      const expandedCount = (!analysisCollapsed ? 1 : 0) + (!logCollapsed ? 1 : 0);
      let sql = clamp(sqlH, MIN_ROW, available - (expandedCount > 0 ? MIN_ROW * Math.min(expandedCount, 1) : 0));
      if (expandedCount === 0) {
        sql = available;
      }

      rowTop.style.flex = '0 0 auto';
      rowTop.style.height = sql + 'px';
      rowTop.style.minHeight = MIN_ROW + 'px';
      rowTop.style.maxHeight = available + 'px';

      if (!analysisCollapsed && !logCollapsed) {
        const rem = available - sql;
        const a = clamp(analysisH, MIN_ROW, Math.max(MIN_ROW, rem - MIN_ROW));
        rowAnalysis.style.flex = '0 0 auto';
        rowAnalysis.style.height = a + 'px';
        rowAnalysis.style.minHeight = MIN_ROW + 'px';
        rowLog.style.flex = '1 1 auto';
        rowLog.style.height = 'auto';
        rowLog.style.minHeight = MIN_ROW + 'px';
      } else if (!analysisCollapsed) {
        rowAnalysis.style.flex = '1 1 auto';
        rowAnalysis.style.height = 'auto';
        rowAnalysis.style.minHeight = MIN_ROW + 'px';
      } else if (!logCollapsed) {
        rowLog.style.flex = '1 1 auto';
        rowLog.style.height = 'auto';
        rowLog.style.minHeight = MIN_ROW + 'px';
      }
    }

    function applyColWidths(sourceW) {
      const total = rowTop.clientWidth - SPLIT;
      const minCol = Math.min(minColWidth(), Math.floor(total / 2));
      if (total <= minCol * 2) {
        paneSource.style.flex = '1 1 0';
        paneSource.style.width = 'auto';
        paneSource.style.minWidth = '25%';
        paneDebug.style.flex = '1 1 0';
        paneDebug.style.width = 'auto';
        paneDebug.style.minWidth = '25%';
        return;
      }
      const sw = clamp(sourceW, minCol, total - minCol);
      paneSource.style.flex = '0 0 auto';
      paneSource.style.width = sw + 'px';
      paneSource.style.minWidth = minCol + 'px';
      paneSource.style.maxWidth = (total - minCol) + 'px';
      paneDebug.style.flex = '1 1 auto';
      paneDebug.style.width = 'auto';
      paneDebug.style.minWidth = minCol + 'px';
    }

    function layoutFromDefaults() {
      const defs = defaultHeights();
      applyLayout(defs.sql, defs.analysis);
      const totalW = rowTop.clientWidth - SPLIT;
      const pct = typeof saved.sourceWidthPct === 'number' ? saved.sourceWidthPct : 0.5;
      applyColWidths(Math.round(totalW * clamp(pct, 0.25, 0.75)));
    }

    function toggleCollapse(which) {
      if (which === 'analysis') {
        analysisCollapsed = !analysisCollapsed;
      } else {
        logCollapsed = !logCollapsed;
      }
      // Expanding always restores default panel sizes
      layoutFromDefaults();
      persistLayout();
    }

    btnCollapseAnalysis.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse('analysis');
    });
    btnCollapseLog.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse('log');
    });

    layoutFromDefaults();
    window.addEventListener('resize', () => {
      const defs = defaultHeights();
      const sqlH = rowTop.getBoundingClientRect().height || defs.sql;
      const analysisH = !analysisCollapsed
        ? (rowAnalysis.getBoundingClientRect().height || defs.analysis)
        : defs.analysis;
      applyLayout(sqlH, analysisH);
      applyColWidths(paneSource.getBoundingClientRect().width);
    });

    function bindVerticalSplit(handle) {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handle.classList.add('active');
        const rowRect = rowTop.getBoundingClientRect();

        function onMove(ev) {
          const minCol = minColWidth();
          const x = clamp(ev.clientX, rowRect.left + minCol, rowRect.right - minCol - SPLIT);
          applyColWidths(x - rowRect.left);
        }
        function onUp() {
          handle.classList.remove('active');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          persistLayout();
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }

    function bindSqlVerticalSplit(handle) {
      handle.addEventListener('mousedown', (e) => {
        if (analysisCollapsed && logCollapsed) return;
        e.preventDefault();
        handle.classList.add('active');
        const wsRect = workspace.getBoundingClientRect();
        const analysisH = !analysisCollapsed
          ? rowAnalysis.getBoundingClientRect().height
          : defaultHeights().analysis;

        function onMove(ev) {
          const defs = defaultHeights();
          const bottomReserve = defs.dockH + ((!analysisCollapsed || !logCollapsed) ? MIN_ROW : 0) + SPLIT;
          const y = clamp(ev.clientY, wsRect.top + MIN_ROW, wsRect.bottom - bottomReserve);
          applyLayout(y - wsRect.top, analysisH);
        }
        function onUp() {
          handle.classList.remove('active');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          persistLayout();
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }

    function bindAnalysisLogSplit(handle) {
      handle.addEventListener('mousedown', (e) => {
        if (analysisCollapsed || logCollapsed) return;
        e.preventDefault();
        handle.classList.add('active');
        const wsRect = workspace.getBoundingClientRect();
        const sqlH = rowTop.getBoundingClientRect().height;

        function onMove(ev) {
          const defs = defaultHeights();
          const y = clamp(
            ev.clientY,
            wsRect.top + sqlH + SPLIT + MIN_ROW,
            wsRect.bottom - defs.dockH - MIN_ROW - SPLIT
          );
          const analysisH = y - (wsRect.top + sqlH + SPLIT);
          applyLayout(sqlH, analysisH);
        }
        function onUp() {
          handle.classList.remove('active');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          persistLayout();
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }

    bindVerticalSplit(document.getElementById('split-source-debug'));
    bindSqlVerticalSplit(splitTopAnalysis);
    bindAnalysisLogSplit(splitAnalysisLog);
  </script>
</body>
</html>`;
}

async function saveTextDialog(
  defaultName: string,
  content: string,
  filters: { [name: string]: string[] },
  sourceUri?: vscode.Uri
): Promise<void> {
  const defaultUri = sourceUri
    ? vscode.Uri.file(path.join(path.dirname(sourceUri.fsPath), defaultName))
    : vscode.Uri.file(
        path.join(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
          defaultName
        )
      );

  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters,
    saveLabel: "Save",
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(
    target,
    Buffer.from(content.endsWith("\n") ? content : content + "\n", "utf8")
  );
  vscode.window.showInformationMessage(
    `SQL SP Harness: saved ${path.basename(target.fsPath)}`
  );
}

async function gotoLine(sourceUri: vscode.Uri, line: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(sourceUri);
  const editor = await vscode.window.showTextDocument(doc, {
    preview: false,
    viewColumn: vscode.ViewColumn.One,
  });
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter
  );
}

function refreshPanel(): void {
  if (!panel || !state) {
    return;
  }
  const label = state.source?.label ?? "Workbench";
  panel.title =
    state.source && hasSource(state)
      ? `SQL SP Harness: ${state.source.label}`
      : "SQL SP Harness";
  panel.webview.html = buildHtml(state);
}

async function readSqlFromUri(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

async function loadSourceFromUri(uri: vscode.Uri): Promise<void> {
  if (path.extname(uri.fsPath).toLowerCase() !== ".sql") {
    vscode.window.showWarningMessage("SQL SP Harness: please choose a .sql file.");
    return;
  }
  // Read via filesystem — do not openTextDocument/showTextDocument (that steals focus into the editor).
  const text = await readSqlFromUri(uri);
  const baseName = path.basename(uri.fsPath, path.extname(uri.fsPath));
  if (!state) {
    state = { stepLog: [] };
  }
  state.source = {
    source: text,
    baseName,
    label: path.basename(uri.fsPath),
    sourceUri: uri,
  };
  state.report = undefined;
  state.debugSql = undefined;
  state.stepLog = [];
  refreshPanel();
}

/** Load a .sql URI into the workbench without opening it as an editor tab. */
export async function loadSqlFileIntoWorkbench(
  context: vscode.ExtensionContext,
  uri: vscode.Uri
): Promise<void> {
  ensurePanel(context);
  if (!state) {
    state = { stepLog: [] };
  }
  await loadSourceFromUri(uri);
  panel?.reveal(vscode.ViewColumn.Beside);
}

async function loadActiveEditorIntoWorkbench(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "sql") {
    vscode.window.showWarningMessage(
      "SQL SP Harness: activate a .sql editor tab first, or use Select File…"
    );
    return;
  }
  const doc = editor.document;
  const filePath = doc.uri.fsPath;
  const baseName = filePath
    ? path.basename(filePath, path.extname(filePath))
    : "script";
  const label = filePath ? path.basename(filePath) : "untitled.sql";
  if (!state) {
    state = { stepLog: [] };
  }
  state.source = {
    source: doc.getText(),
    baseName,
    label,
    sourceUri: filePath ? doc.uri : undefined,
  };
  state.report = undefined;
  state.debugSql = undefined;
  state.stepLog = [];
  refreshPanel();
}

async function browseForSqlFile(): Promise<void> {
  const uris = await vscode.workspace.findFiles(
    "**/*.sql",
    "**/{node_modules,.git,out,dist}/**",
    500
  );
  if (uris.length === 0) {
    vscode.window.showWarningMessage(
      "SQL SP Harness: no .sql files found in the workspace."
    );
    return;
  }

  uris.sort((a, b) =>
    vscode.workspace
      .asRelativePath(a)
      .localeCompare(vscode.workspace.asRelativePath(b))
  );

  type SqlPick = vscode.QuickPickItem & { uri: vscode.Uri };
  const items: SqlPick[] = uris.map((uri) => ({
    label: path.basename(uri.fsPath),
    description: vscode.workspace.asRelativePath(uri),
    uri,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a .sql file from the workspace",
    matchOnDescription: true,
  });
  if (!picked) {
    return;
  }
  await loadSourceFromUri(picked.uri);
}

function ensurePanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return panel;
  }

  panel = vscode.window.createWebviewPanel(
    "sqlSpHarness.workbench",
    "SQL SP Harness",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    }
  );

  panel.onDidDispose(() => {
    panel = undefined;
  });

  panel.webview.onDidReceiveMessage(
    async (message: {
      type: string;
      line?: number;
      uri?: string;
      label?: string;
      content?: string;
      message?: string;
    }) => {
      if (!state) {
        state = { stepLog: [] };
      }

      switch (message.type) {
        case "browse":
          await browseForSqlFile();
          break;
        case "loadActive":
          await loadActiveEditorIntoWorkbench();
          break;
        case "analyze":
          await runAnalyzeInWorkbench();
          break;
        case "generate":
          await runGenerateInWorkbench();
          break;
        case "saveAnalysis":
          if (state.report && state.source) {
            await saveTextDialog(
              `${state.source.baseName}_analysis.txt`,
              state.report.plainText,
              { "Text Report": ["txt"], "All Files": ["*"] },
              state.source.sourceUri
            );
          }
          break;
        case "saveDebug":
          if (state.debugSql && state.source) {
            await saveTextDialog(
              `${state.source.baseName}_debug.sql`,
              state.debugSql,
              { SQL: ["sql"], "All Files": ["*"] },
              state.source.sourceUri
            );
          }
          break;
        case "saveLog":
          if (state.stepLog.length && state.source) {
            await saveTextDialog(
              `${state.source.baseName}.log`,
              state.stepLog.join("\n"),
              { Log: ["log", "txt"], "All Files": ["*"] },
              state.source.sourceUri
            );
          }
          break;
        case "openDebug":
          if (state.debugSql) {
            const doc = await vscode.workspace.openTextDocument({
              content: state.debugSql,
              language: "sql",
            });
            await vscode.window.showTextDocument(doc, {
              preview: false,
              viewColumn: vscode.ViewColumn.One,
            });
          }
          break;
        case "gotoLine":
          if (state.source?.sourceUri && message.line !== undefined) {
            await gotoLine(state.source.sourceUri, message.line);
          }
          break;
      }
    }
  );

  context.subscriptions.push(panel);
  return panel;
}

async function runAnalyzeInWorkbench(): Promise<void> {
  if (!state || !hasSource(state) || !state.source) {
    vscode.window.showWarningMessage(
      "SQL SP Harness: load a .sql file first (Select File… or Load Active)."
    );
    return;
  }
  const report = analyze(state.source.source);
  state.report = report;
  state.stepLog = report.stepLog;
  state.lastAction = "analyze";
  refreshPanel();

  const warnings = realWarnings(report);
  if (warnings.length) {
    vscode.window.showWarningMessage(
      `SQL SP Harness: ${warnings.length} warning(s) — see Analysis › Warnings.`
    );
  }
}

async function runGenerateInWorkbench(): Promise<void> {
  if (!state || !hasSource(state) || !state.source) {
    vscode.window.showWarningMessage(
      "SQL SP Harness: load a .sql file first (Select File… or Load Active)."
    );
    return;
  }
  const { traceStyle } = getSpDebugSettings();
  const result = generate(state.source.source, { traceStyle });
  state.debugSql = result.sql;
  state.stepLog = result.stepLog;
  state.lastAction = "generate";
  refreshPanel();

  if (result.stats.warnings.length) {
    vscode.window.showWarningMessage(
      "SQL SP Harness: debug script generated with warnings — review Active log / Analysis."
    );
  }
}

/** Open an empty workbench (Select File… or Load Active to load SQL). */
export function openEmptyWorkbench(context: vscode.ExtensionContext): void {
  state = { stepLog: [] };
  ensurePanel(context);
  refreshPanel();
}

/** Open or refresh the workbench with the given SQL source. */
export function showHarnessWorkbench(
  context: vscode.ExtensionContext,
  source: SqlSourceContext,
  options?: {
    report?: AnalyzeReport;
    debugSql?: string;
    stepLog?: string[];
    runAnalyze?: boolean;
    runGenerate?: boolean;
  }
): void {
  state = {
    source,
    report: options?.report,
    debugSql: options?.debugSql,
    stepLog: options?.stepLog ?? options?.report?.stepLog ?? [],
  };

  ensurePanel(context);
  refreshPanel();

  void (async () => {
    if (options?.runAnalyze) {
      await runAnalyzeInWorkbench();
    }
    if (options?.runGenerate) {
      await runGenerateInWorkbench();
    }
  })();
}

export function showAnalyzeReportPanel(
  context: vscode.ExtensionContext,
  _fileLabel: string,
  report: AnalyzeReport,
  sqlSource: SqlSourceContext
): void {
  showHarnessWorkbench(context, sqlSource, {
    report,
    stepLog: report.stepLog,
  });
}

export function writeStepLogBesideSource(
  stepLog: string[],
  sourceUri: vscode.Uri,
  baseName: string
): string {
  const logPath = path.join(path.dirname(sourceUri.fsPath), `${baseName}.log`);
  fs.writeFileSync(logPath, stepLog.join("\n") + "\n", "utf-8");
  return logPath;
}
