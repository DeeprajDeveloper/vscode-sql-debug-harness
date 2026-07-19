import {
  ALREADY_STUBBED,
  DELETE_FROM_CLAUSE,
  DELETE_TABLE_VAR,
  DML_START,
  EXEC_DYNAMIC,
  EXEC_START,
  INSERT_TABLE_VAR,
  INSERT_TARGET,
  LINE_INDENT,
  SELECT_ASSIGN,
  SET_NOCOUNT,
  SET_VAR_LINE,
  TCL_START,
  UPDATE_TABLE_VAR,
  UPDATE_TARGET,
} from "./constants";
import { stripSqlComments } from "./comments";
import { buildDmlPreview } from "./dmlPreview";
import { buildExecStub, findExecBlockEnd } from "./execPreview";
import { prepareForTransform, stripGoBatches } from "./prepare";
import { findDmlBlockEnd, scanTsql } from "./scan";
import { detectUnsupported } from "./unsupported";
import { tryParseTransactSql } from "./parser";
import type {
  GenerateOptions,
  LogCallback,
  TraceStyle,
  TransformResult,
  TransformStats,
} from "./types";
import { emitLog, StepLogCollector, truncateForLog } from "./log";

function emptyStats(warnings: string[] = []): TransformStats {
  return {
    dmlStubbed: 0,
    execStubbed: 0,
    tclNeutralized: 0,
    tracesAdded: 0,
    warnings,
  };
}

function emitProgress(
  onProgress: ((m: string) => void) | undefined,
  onLog: LogCallback | undefined,
  fn: string,
  message: string
): void {
  onProgress?.(message);
  emitLog(onLog, fn, message);
}

function isTableVariableDml(firstLine: string): boolean {
  return (
    INSERT_TABLE_VAR.test(firstLine) ||
    UPDATE_TABLE_VAR.test(firstLine) ||
    DELETE_TABLE_VAR.test(firstLine)
  );
}

function findDmlLineBlocks(lines: string[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (ALREADY_STUBBED.test(line)) {
      i += 1;
      continue;
    }
    if (!DML_START.test(line)) {
      i += 1;
      continue;
    }
    if (isTableVariableDml(line)) {
      i += 1;
      continue;
    }
    const start = i;
    const end = findDmlBlockEnd(lines, start);
    blocks.push([start, end]);
    i = end + 1;
  }
  return blocks;
}

function findExecLineBlocks(lines: string[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (ALREADY_STUBBED.test(line)) {
      i += 1;
      continue;
    }
    if (EXEC_DYNAMIC.test(line) || !EXEC_START.test(line)) {
      i += 1;
      continue;
    }
    const start = i;
    const end = findExecBlockEnd(lines, start);
    blocks.push([start, end]);
    i = end + 1;
  }
  return blocks;
}

function findTclLines(lines: string[]): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ALREADY_STUBBED.test(lines[i])) {
      continue;
    }
    if (TCL_START.test(lines[i])) {
      idxs.push(i);
    }
  }
  return idxs;
}

function dmlTargetLabel(firstLine: string, kind: string): string {
  if (kind === "INSERT") {
    const m = INSERT_TARGET.exec(firstLine);
    return m ? m[1] : "table";
  }
  if (kind === "UPDATE") {
    const m = UPDATE_TARGET.exec(firstLine);
    return m ? m[1] : "table";
  }
  if (kind === "DELETE") {
    const m = DELETE_FROM_CLAUSE.exec(firstLine);
    return m ? m[1] : "table";
  }
  return "statement";
}

function replaceDmlBlock(blockLines: string[], indent: string): string[] {
  const preview = buildDmlPreview(blockLines, indent);
  if (preview) {
    return preview;
  }
  const first = blockLines[0].trim();
  const kind = first.split(/\s+/)[0].toUpperCase();
  const target = dmlTargetLabel(first, kind);
  const stubMsg = `${indent}RAISERROR(N'[DBG] Skipped ${kind} ${target}', 0, 1) WITH NOWAIT;`;
  const commented = blockLines
    .map((ln) => (ln.trim() ? `${indent}-- ${ln}` : ln))
    .join("\n");
  return [
    `${indent}/* [DBG-DISABLED] ${kind} ${target}`,
    commented,
    `${indent}*/`,
    stubMsg,
  ];
}

function replaceExecBlock(blockLines: string[], indent: string): string[] {
  const preview = buildExecStub(blockLines, indent);
  if (preview) {
    return preview;
  }
  const commented = blockLines
    .map((ln) => (ln.trim() ? `${indent}-- ${ln}` : ln))
    .join("\n");
  return [
    `${indent}/* [DBG-DISABLED] EXEC`,
    commented,
    `${indent}*/`,
    `${indent}PRINT N'[DBG-EXEC] Skipped unsupported EXEC statement';`,
  ];
}

function neutralizeTclLine(line: string, indent: string): string[] {
  const trimmed = line.trim().replace(/;+$/, "");
  return [
    `${indent}-- [DBG-TCL] Neutralized: ${trimmed}`,
    `${indent}PRINT N'[DBG-TCL] Skipped ${trimmed.replace(/'/g, "''")}';`,
  ];
}

function traceLineForVar(
  varName: string,
  indent: string,
  style: TraceStyle
): string {
  const castExpr = `CAST(${varName} AS NVARCHAR(4000))`;
  if (style === "print") {
    return `${indent}PRINT CONCAT(N'[DBG] ${varName} = ', ${castExpr});`;
  }
  return `${indent}RAISERROR(N'[DBG] ${varName} = %s', 0, 1, ${castExpr}) WITH NOWAIT;`;
}

function injectSetTraces(
  text: string,
  traceStyle: TraceStyle,
  onDetail?: LogCallback
): [string, number] {
  let count = 0;
  // Match SET @var = ... line by line for reliable indent
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    out.push(line);
    const m = SET_VAR_LINE.exec(line);
    if (!m || SET_NOCOUNT.test(line)) {
      continue;
    }
    const indent = m[1] || "    ";
    const varName = m[2];
    const trace = traceLineForVar(varName, indent, traceStyle);
    out.push(trace);
    count += 1;
    emitLog(
      onDetail,
      "injectSetTraces",
      `  SET trace added: ${varName} (${traceStyle}) after ${truncateForLog(line)}`
    );
  }
  return [out.join("\n"), count];
}

function varsFromSelectAssignments(selectSql: string): string[] {
  const names: string[] = [];
  const re = /(@\w+)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selectSql))) {
    if (!names.includes(m[1])) {
      names.push(m[1]);
    }
  }
  return names;
}

function injectSelectTraces(
  text: string,
  traceStyle: TraceStyle,
  onDetail?: LogCallback
): [string, number] {
  let count = 0;
  const result = text.replace(SELECT_ASSIGN, (full, stmt: string) => {
    const vars = varsFromSelectAssignments(stmt);
    if (!vars.length) {
      return full;
    }
    const indent = "    ";
    const traces = vars
      .map((v) => traceLineForVar(v, indent, traceStyle))
      .join("\n");
    count += vars.length;
    emitLog(
      onDetail,
      "injectSelectTraces",
      `  SELECT @assign trace(s) added: ${vars.join(", ")} (${traceStyle})`
    );
    return full + "\n" + traces;
  });
  return [result, count];
}

function debugBanner(parseErrors: string[], stats: TransformStats): string {
  const lines = [
    "-- ============================================================================",
    "-- DEBUG HARNESS — DO NOT RUN ON PRODUCTION",
    "-- Transformed & Generated by sql-sp-harness (TypeScript / VS Code extension).",
    "-- DML replaced with SELECT previews; EXEC calls replaced with PRINT stubs; TCL neutralized; variable traces injected.",
    "-- Please ensure to review the procedure for any potential side effects before running.",
    "-- ============================================================================",
    `-- DML statements stubbed: ${stats.dmlStubbed}`,
    `-- EXEC statements stubbed: ${stats.execStubbed}`,
    `-- TCL statements neutralized: ${stats.tclNeutralized}`,
    `-- Trace lines added: ${stats.tracesAdded}`,
  ];
  if (parseErrors.length) {
    lines.push("-- PARSE WARNINGS (review manually):");
    for (const err of parseErrors) {
      lines.push(`-- ${err}`);
    }
  }
  for (const w of stats.warnings) {
    lines.push(`-- ${w}`);
  }
  lines.push(
    "-- ============================================================================"
  );
  lines.push("");
  return lines.join("\n") + "\n";
}

function applyLineEdits(
  lines: string[],
  options: {
    traceStyle: TraceStyle;
    stubDml: boolean;
    addBlockMarkers: boolean;
    onProgress?: (m: string) => void;
    onLog?: LogCallback;
  }
): [string[], TransformStats] {
  const stats = emptyStats();
  const { onProgress, onLog } = options;

  if (options.stubDml) {
    const blocks = findDmlLineBlocks(lines);
    if (blocks.length) {
      emitProgress(
        onProgress,
        onLog,
        "applyLineEdits",
        `Stubbing ${blocks.length} DML block(s) (INSERT/UPDATE/DELETE/MERGE)...`
      );
    }
    for (const [start, end] of [...blocks].reverse()) {
      const block = lines.slice(start, end + 1);
      const indentMatch = LINE_INDENT.exec(block[0]);
      const indent = indentMatch ? indentMatch[1] : "";
      const kind = block[0].trim().split(/\s+/)[0].toUpperCase();
      const preview = block[0].trim().replace(/\s+/g, " ").slice(0, 100);
      emitProgress(
        onProgress,
        onLog,
        "applyLineEdits",
        `Stubbing ${kind} lines ${start + 1}-${end + 1}: ${preview}`
      );
      const replacement = replaceDmlBlock(block, indent);
      lines.splice(start, end - start + 1, ...replacement);
      stats.dmlStubbed += 1;
    }
  }

  const execBlocks = findExecLineBlocks(lines);
  if (execBlocks.length) {
    emitProgress(
      onProgress,
      onLog,
      "applyLineEdits",
      `Stubbing ${execBlocks.length} EXEC block(s)...`
    );
  }
  for (const [start, end] of [...execBlocks].reverse()) {
    const block = lines.slice(start, end + 1);
    const indentMatch = LINE_INDENT.exec(block[0]);
    const indent = indentMatch ? indentMatch[1] : "";
    const replacement = replaceExecBlock(block, indent);
    lines.splice(start, end - start + 1, ...replacement);
    stats.execStubbed += 1;
  }

  const tclLines = findTclLines(lines);
  if (tclLines.length) {
    emitProgress(
      onProgress,
      onLog,
      "applyLineEdits",
      `Neutralizing ${tclLines.length} TCL statement(s)...`
    );
  }
  for (const idx of [...tclLines].reverse()) {
    const indentMatch = LINE_INDENT.exec(lines[idx]);
    const indent = indentMatch ? indentMatch[1] : "";
    const replacement = neutralizeTclLine(lines[idx], indent);
    lines.splice(idx, 1, ...replacement);
    stats.tclNeutralized += 1;
  }

  emitProgress(onProgress, onLog, "applyLineEdits", "Injecting SET variable traces...");
  let text = lines.join("\n");
  let setTraces = 0;
  [text, setTraces] = injectSetTraces(text, options.traceStyle, onLog);
  emitProgress(
    onProgress,
    onLog,
    "applyLineEdits",
    `  -> added ${setTraces} SET trace(s) (style=${options.traceStyle})`
  );

  emitProgress(
    onProgress,
    onLog,
    "applyLineEdits",
    "Injecting SELECT assignment traces..."
  );
  let selectTraces = 0;
  [text, selectTraces] = injectSelectTraces(text, options.traceStyle, onLog);
  emitProgress(
    onProgress,
    onLog,
    "applyLineEdits",
    `  -> added ${selectTraces} SELECT @assign trace(s)`
  );
  stats.tracesAdded += setTraces + selectTraces;
  lines = text.split(/\r?\n/);

  if (options.addBlockMarkers) {
    emitProgress(
      onProgress,
      onLog,
      "applyLineEdits",
      "Adding IF/WHILE block markers..."
    );
    let step = 0;
    const markers: Array<[number, string]> = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const stripped = lines[idx].trim().toUpperCase();
      if (stripped.startsWith("IF ") || stripped.startsWith("WHILE ")) {
        step += 1;
        const indent = LINE_INDENT.exec(lines[idx])?.[1] ?? "";
        const marker = `${indent}-- [DBG] Step ${step}: ${lines[idx].trim().slice(0, 80)}`;
        markers.push([idx, marker]);
        stats.warnings.push(`Block marker at step ${step}`);
      }
    }
    for (const [offset, [idx, marker]] of markers.entries()) {
      lines.splice(idx + offset, 0, marker);
    }
  }

  return [lines, stats];
}

export function transformSql(
  sql: string,
  options: GenerateOptions = {}
): TransformResult {
  const collector = new StepLogCollector();
  const onLog: LogCallback = (fn, msg) => {
    collector.info(fn, msg);
    options.onLog?.(fn, msg);
  };
  const onProgress = options.onProgress;
  const traceStyle = options.traceStyle ?? "print";
  const stubDml = options.stubDml !== false;
  const addBlockMarkers = options.addBlockMarkers === true;
  const stripComments = options.stripComments !== false;

  if (stripComments) {
    emitProgress(onProgress, onLog, "transformSql", "Stripping comments from source...");
    sql = stripSqlComments(sql, onLog);
  }

  emitProgress(
    onProgress,
    onLog,
    "transformSql",
    "Preparing script (remove deploy preamble, inline parameters)..."
  );
  sql = prepareForTransform(sql, { onDetail: onLog });
  sql = stripGoBatches(sql, onLog);

  const parseAttempt = tryParseTransactSql(sql, onLog);
  const unsupported = detectUnsupported(sql);
  const warnings = [
    ...parseAttempt.warnings,
    ...unsupported.map((u) => u.message),
  ];
  if (!parseAttempt.ok && parseAttempt.parseError) {
    emitLog(
      onLog,
      "transformSql",
      `AST unavailable (using text scan): ${parseAttempt.parseError}`
    );
  }
  const scan = scanTsql(sql);
  emitProgress(
    onProgress,
    onLog,
    "transformSql",
    `Text scan: INSERT=${scan.insert} UPDATE=${scan.update} DELETE=${scan.delete} MERGE=${scan.merge} TRY/CATCH=${scan.tryCatchBlocks}`
  );

  const [lines, lineStats] = applyLineEdits(sql.split(/\r?\n/), {
    traceStyle,
    stubDml,
    addBlockMarkers,
    onProgress,
    onLog,
  });
  lineStats.warnings = [...warnings, ...lineStats.warnings];

  emitProgress(onProgress, onLog, "transformSql", "Writing debug harness banner...");
  let body = lines.join("\n");
  if (!body.endsWith("\n") && sql.endsWith("\n")) {
    body += "\n";
  }
  const output = debugBanner(parseAttempt.errors, lineStats) + body;

  emitProgress(
    onProgress,
    onLog,
    "transformSql",
    `Transform complete: ${lineStats.dmlStubbed} DML stubbed, ${lineStats.execStubbed} EXEC stubbed, ${lineStats.tclNeutralized} TCL neutralized, ${lineStats.tracesAdded} trace(s) added.`
  );

  return {
    sql: output,
    stats: lineStats,
    parseErrors: parseAttempt.errors,
    stepLog: collector.lines,
  };
}

export function generate(
  sql: string,
  options: GenerateOptions = {}
): TransformResult {
  return transformSql(sql, options);
}
