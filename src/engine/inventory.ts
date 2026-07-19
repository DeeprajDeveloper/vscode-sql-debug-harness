import {
  IF_STMT,
  SELECT_VAR_ASSIGN,
  SET_ASSIGN,
  SET_NOCOUNT,
  WHILE_STMT,
} from "./constants";
import { stripBlockCommentsOnLine } from "./comments";
import { prepareForAnalysis, stripGoBatches } from "./prepare";
import { tryParseTransactSql } from "./parser";
import {
  scanHasStructure,
  scanTsql,
  summarizeDml,
  summarizeTryCatch,
} from "./scan";
import { detectUnsupported } from "./unsupported";
import type {
  AnalyzeIdentifiedRow,
  AnalyzeReport,
  AnalyzeSummaryRow,
  AnalyzeWarningRow,
  InventoryCounts,
  LogCallback,
} from "./types";
import { emitLog, StepLogCollector } from "./log";

const COUNT_SECTIONS: Array<[string, keyof InventoryCounts]> = [
  ["INSERT", "insert"],
  ["UPDATE", "update"],
  ["DELETE", "delete"],
  ["MERGE", "merge"],
  ["TRY/CATCH blocks", "tryCatchBlocks"],
  ["IF", "ifCount"],
  ["WHILE", "whileCount"],
  ["SET (all)", "setCount"],
  ["SET (@variables)", "setVariable"],
  ["SELECT @assignments", "selectAssign"],
];

function countLinePatterns(sql: string): {
  ifCount: number;
  whileCount: number;
  setCount: number;
  setVariable: number;
  selectAssign: number;
  details: Record<string, string[]>;
} {
  const lines = sql.split(/\r?\n/);
  let ifCount = 0;
  let whileCount = 0;
  let setCount = 0;
  let setVariable = 0;
  let selectAssign = 0;
  const details: Record<string, string[]> = {};
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const [effective, nextInBlock] = stripBlockCommentsOnLine(
      lines[i],
      inBlockComment
    );
    inBlockComment = nextInBlock;
    if (!effective.trim()) {
      continue;
    }
    const lineNo = i + 1;
    const preview = effective.replace(/\s+/g, " ").trim().slice(0, 120);

    if (IF_STMT.test(effective)) {
      ifCount += 1;
      (details["IF"] ??= []).push(`L${lineNo}: ${preview}`);
    }
    if (WHILE_STMT.test(effective)) {
      whileCount += 1;
      (details["WHILE"] ??= []).push(`L${lineNo}: ${preview}`);
    }
    if (SET_ASSIGN.test(effective) || SET_NOCOUNT.test(effective)) {
      setCount += 1;
      if (SET_ASSIGN.test(effective) && !SET_NOCOUNT.test(effective)) {
        setVariable += 1;
        (details["SET (@variables)"] ??= []).push(`L${lineNo}: ${preview}`);
      }
    }
    if (SELECT_VAR_ASSIGN.test(effective)) {
      selectAssign += 1;
      (details["SELECT @assignments"] ??= []).push(`L${lineNo}: ${preview}`);
    }
  }

  return { ifCount, whileCount, setCount, setVariable, selectAssign, details };
}

export function inventoryFromSql(
  sql: string,
  onDetail?: LogCallback
): InventoryCounts {
  sql = prepareForAnalysis(sql, { onDetail });
  sql = stripGoBatches(sql, onDetail);
  const parseAttempt = tryParseTransactSql(sql, onDetail);
  const scan = scanTsql(sql);
  const lineCounts = countLinePatterns(sql);
  const unsupported = detectUnsupported(sql);

  const details: Record<string, string[]> = { ...lineCounts.details };
  for (const finding of scan.dmlFindings) {
    (details[finding.kind] ??= []).push(summarizeDml(finding));
  }
  for (const finding of scan.tryCatchFindings) {
    (details["TRY/CATCH blocks"] ??= []).push(summarizeTryCatch(finding));
  }

  const warnings = [...parseAttempt.warnings, ...scan.notes, ...unsupported.map((u) => u.message)];
  // AST failure is expected for many T-SQL procs; only surface it if text scan found nothing useful.
  if (!parseAttempt.ok && parseAttempt.parseError && !scanHasStructure(scan) && !sql.trim()) {
    warnings.push(`AST parse incomplete: ${parseAttempt.parseError}`);
  } else if (!parseAttempt.ok && parseAttempt.parseError) {
    emitLog(
      onDetail,
      "inventoryFromSql",
      `AST unavailable (using text scan): ${parseAttempt.parseError}`
    );
  }

  const usable = parseAttempt.ok || scanHasStructure(scan) || sql.trim().length > 0;

  return {
    isParsable: usable,
    errors: [...parseAttempt.errors],
    warnings,
    insert: scan.insert,
    update: scan.update,
    delete: scan.delete,
    merge: scan.merge,
    ifCount: lineCounts.ifCount,
    whileCount: lineCounts.whileCount,
    setCount: lineCounts.setCount,
    setVariable: lineCounts.setVariable,
    selectAssign: lineCounts.selectAssign,
    tryCatchBlocks: scan.tryCatchBlocks,
    cursorCount: unsupported.filter((u) => u.kind === "cursor").length,
    dynamicSqlCount: unsupported.filter((u) => u.kind === "dynamic_sql").length,
    details,
  };
}

function pad(cell: string, width: number): string {
  return cell + " ".repeat(Math.max(0, width - cell.length));
}

function renderTable(
  title: string,
  headers: [string, string],
  rows: Array<[string, string]>
): string[] {
  if (!rows.length) {
    return [];
  }
  const widths = [
    Math.max(headers[0].length, ...rows.map((r) => r[0].length)),
    Math.max(headers[1].length, ...rows.map((r) => r[1].length)),
  ];
  const fmt = (cells: [string, string]) =>
    `  ${pad(cells[0], widths[0])}  ${pad(cells[1], widths[1])}`;
  const sep = `  ${"-".repeat(widths[0])}  ${"-".repeat(widths[1])}`;
  return ["", title, fmt(headers), sep, ...rows.map(fmt)];
}

export function inventoryToPlainText(inv: InventoryCounts): string {
  const lines: string[] = [
    "sql-sp-harness - Analysis Report",
    "-".repeat(72),
  ];

  const summaryRows: Array<[string, string]> = [
    ["is_parsable", String(inv.isParsable)],
  ];
  for (const [label, attr] of COUNT_SECTIONS) {
    const value = inv[attr];
    if (typeof value === "number") {
      summaryRows.push([label, String(value)]);
    }
  }
  if (inv.cursorCount) {
    summaryRows.push(["Cursors", String(inv.cursorCount)]);
  }
  if (inv.dynamicSqlCount) {
    summaryRows.push(["Dynamic SQL", String(inv.dynamicSqlCount)]);
  }

  lines.push(...renderTable("Summary", ["Element", "Count"], summaryRows));

  const issueRows: Array<[string, string]> = [];
  for (const err of inv.errors) {
    issueRows.push(["Error", err]);
  }
  for (const warn of inv.warnings) {
    issueRows.push(["Warning", warn]);
  }
  lines.push(
    ...renderTable(
      "Warnings & Errors",
      ["Type", "Message"],
      issueRows.length ? issueRows : [["—", "None"]]
    )
  );

  const identified: Array<[string, string]> = [];
  for (const [label] of COUNT_SECTIONS) {
    for (const detail of inv.details[label] ?? []) {
      identified.push([label, detail]);
    }
  }
  for (const [label, items] of Object.entries(inv.details)) {
    if (COUNT_SECTIONS.some(([l]) => l === label)) {
      continue;
    }
    for (const detail of items) {
      identified.push([label, detail]);
    }
  }
  if (identified.length) {
    lines.push(...renderTable("Identified", ["Kind", "Detail"], identified));
  }

  lines.push("-".repeat(72));
  return lines.join("\n");
}

function parseLineNumber(detail: string): number | undefined {
  const match = /^L(\d+):/.exec(detail);
  if (match) {
    return parseInt(match[1], 10);
  }
  const rangeMatch = /L(\d+)-L\d+/.exec(detail);
  if (rangeMatch) {
    return parseInt(rangeMatch[1], 10);
  }
  return undefined;
}

export function inventoryToAnalyzeReport(
  inv: InventoryCounts,
  stepLog: string[] = []
): AnalyzeReport {
  const summary: AnalyzeSummaryRow[] = [
    { element: "is_parsable", count: String(inv.isParsable) },
  ];
  for (const [label, attr] of COUNT_SECTIONS) {
    const value = inv[attr];
    if (typeof value === "number") {
      summary.push({ element: label, count: String(value) });
    }
  }

  const warnings: AnalyzeWarningRow[] = [];
  for (const err of inv.errors) {
    warnings.push({ type: "Error", message: err });
  }
  for (const warn of inv.warnings) {
    warnings.push({ type: "Warning", message: warn });
  }
  if (!warnings.length) {
    warnings.push({ type: "—", message: "None" });
  }

  const identified: AnalyzeIdentifiedRow[] = [];
  for (const [kind, items] of Object.entries(inv.details)) {
    for (const detail of items) {
      identified.push({ kind, detail, line: parseLineNumber(detail) });
    }
  }

  const plainText = inventoryToPlainText(inv);
  return {
    title: "sql-sp-harness - Analysis Report",
    isParsable: inv.isParsable,
    summary,
    warnings,
    identified,
    stepLog,
    plainText,
  };
}

export function analyze(
  sql: string,
  options?: { onLog?: LogCallback }
): AnalyzeReport {
  const collector = new StepLogCollector();
  const onDetail: LogCallback = (fn, msg) => {
    collector.info(fn, msg);
    options?.onLog?.(fn, msg);
  };
  onDetail("analyze", "Running inventory analysis (text scan + optional AST)");
  const inv = inventoryFromSql(sql, onDetail);
  return inventoryToAnalyzeReport(inv, collector.lines);
}
