import {
  AS_BEGIN_REST,
  AS_LINE,
  CREATE_PROC,
  CREATE_PROC_INLINE,
  DROP_PROCEDURE,
  IF_EXISTS,
  PROC_PARAM_PLAIN,
  PROC_PARAM_WITH_DEFAULT,
  SET_ANSI_NULLS,
  SET_QUOTED_IDENTIFIER,
  STANDALONE_DROP_PROC,
} from "./constants";
import type { LogCallback } from "./types";
import { emitLog, truncateForLog } from "./log";

const EXISTS_OPEN = /\bEXISTS\s*\(/i;

function scanParenBlockEndLine(
  lines: string[],
  startLine: number,
  openParenCol: number
): number {
  let depth = 0;
  for (let lineIdx = startLine; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let col = lineIdx === startLine ? openParenCol : 0;
    let inString = false;
    while (col < line.length) {
      const ch = line[col];
      if (ch === "'") {
        if (inString && col + 1 < line.length && line[col + 1] === "'") {
          col += 2;
          continue;
        }
        inString = !inString;
        col += 1;
        continue;
      }
      if (!inString) {
        if (ch === "(") {
          depth += 1;
        } else if (ch === ")") {
          depth -= 1;
          if (depth === 0) {
            return lineIdx;
          }
        }
      }
      col += 1;
    }
  }
  return startLine;
}

function deployIfExistsDropSpan(
  lines: string[],
  start: number
): [number, number] | null {
  if (start >= lines.length || !IF_EXISTS.test(lines[start])) {
    return null;
  }
  const openMatch = EXISTS_OPEN.exec(lines[start]);
  if (!openMatch) {
    return null;
  }
  const closeLine = scanParenBlockEndLine(
    lines,
    start,
    openMatch.index + openMatch[0].length - 1
  );
  let scan = closeLine + 1;
  while (scan < lines.length && !lines[scan].trim()) {
    scan += 1;
  }
  if (scan >= lines.length || !DROP_PROCEDURE.test(lines[scan])) {
    return null;
  }
  return [start, scan + 1];
}

function splitParamList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      const part = current.trim();
      if (part) {
        parts.push(part);
      }
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

export function stripDeployPreamble(sql: string, onDetail?: LogCallback): string {
  const hadTrailingNewline = sql.endsWith("\n");
  const lines = sql.split(/\r?\n/);
  const kept: string[] = [];
  let removed = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const deploySpan = deployIfExistsDropSpan(lines, i);
    if (deploySpan) {
      const [start, end] = deploySpan;
      for (let dropIdx = start; dropIdx < end; dropIdx++) {
        emitLog(
          onDetail,
          "stripDeployPreamble",
          `  preamble line ${dropIdx + 1}: removed deploy IF EXISTS/DROP: ${truncateForLog(lines[dropIdx])}`
        );
        removed += 1;
      }
      i = end;
      continue;
    }
    if (STANDALONE_DROP_PROC.test(line)) {
      emitLog(
        onDetail,
        "stripDeployPreamble",
        `  preamble line ${i + 1}: removed standalone DROP PROCEDURE: ${truncateForLog(line)}`
      );
      i += 1;
      removed += 1;
      continue;
    }
    if (SET_ANSI_NULLS.test(line) || SET_QUOTED_IDENTIFIER.test(line)) {
      emitLog(
        onDetail,
        "stripDeployPreamble",
        `  preamble line ${i + 1}: removed SET option: ${truncateForLog(line)}`
      );
      i += 1;
      removed += 1;
      continue;
    }
    kept.push(line);
    i += 1;
  }
  emitLog(
    onDetail,
    "stripDeployPreamble",
    `Deploy preamble: removed ${removed} line(s), kept ${kept.length} line(s)`
  );
  if (kept.length === 0) {
    return hadTrailingNewline ? "\n" : "";
  }
  const body = kept.join("\n");
  return hadTrailingNewline ? body + "\n" : body;
}

function parseParameterChunks(
  chunks: string[]
): Array<[string, string, string | null]> {
  const params: Array<[string, string, string | null]> = [];
  for (const chunk of chunks) {
    const text = chunk.trim().replace(/,+$/, "").trim();
    if (!text || !text.startsWith("@")) {
      continue;
    }
    let match = PROC_PARAM_WITH_DEFAULT.exec(text);
    if (match) {
      params.push([match[1], match[2].trim(), match[3].trim()]);
      continue;
    }
    match = PROC_PARAM_PLAIN.exec(text);
    if (match) {
      params.push([match[1], match[2].trim(), null]);
    }
  }
  return params;
}

function declareLinesForParams(
  procName: string,
  params: Array<[string, string, string | null]>,
  indent: string
): string[] {
  const header = `${indent}-- [DBG] Harness: was CREATE PROCEDURE ${procName}; set parameter values below.`;
  if (params.length === 0) {
    return [header, `${indent}-- (no parameters)`];
  }
  const lines = [header];
  for (const [name, typeSql, defaultVal] of params) {
    if (defaultVal) {
      lines.push(`${indent}DECLARE ${name} ${typeSql} = ${defaultVal};`);
    } else {
      lines.push(
        `${indent}DECLARE ${name} ${typeSql} = NULL;  -- TODO: set test value`
      );
    }
  }
  return lines;
}

function splitCreateTail(tail: string): [string, boolean] {
  const match = /\s+AS(?:\s+BEGIN)?\s*$/i.exec(tail);
  if (!match) {
    return [tail.trim(), false];
  }
  const paramText = tail.slice(0, match.index).trim();
  const hasBegin = /BEGIN/i.test(match[0]);
  return [paramText, hasBegin];
}

export function convertCreateProcedureToDeclares(
  sql: string,
  onDetail?: LogCallback
): string {
  const lines = sql.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let conversions = 0;
  while (i < lines.length) {
    const line = lines[i];
    const head = CREATE_PROC.exec(line);
    if (!head) {
      out.push(line);
      i += 1;
      continue;
    }

    const procName = head[1];
    const lineNo = i + 1;
    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch ? indentMatch[1] : "";

    const inline = CREATE_PROC_INLINE.exec(line);
    let paramChunks: string[] = [];
    let asHasBegin = false;
    let bodySuffix = "";

    if (inline && inline[2].trim()) {
      const tail = inline[2].trim();
      const beginRest = AS_BEGIN_REST.exec(tail);
      if (beginRest) {
        asHasBegin = true;
        bodySuffix = beginRest[1].trim();
      } else {
        const [paramText, hasBegin] = splitCreateTail(tail);
        asHasBegin = hasBegin;
        if (paramText) {
          paramChunks = splitParamList(paramText);
        }
      }
      i += 1;
    } else {
      i += 1;
      const paramParts: string[] = [];
      while (i < lines.length) {
        if (AS_LINE.test(lines[i])) {
          asHasBegin = /\bBEGIN\b/i.test(lines[i]);
          i += 1;
          break;
        }
        paramParts.push(lines[i].trim());
        i += 1;
      }
      paramChunks = splitParamList(paramParts.join(" "));
    }

    const params = parseParameterChunks(paramChunks);
    const declareLines = declareLinesForParams(procName, params, indent);
    emitLog(
      onDetail,
      "convertCreateProcedureToDeclares",
      `  line ${lineNo}: CREATE PROCEDURE ${procName} -> ${params.length} parameter DECLARE(s), as_begin=${asHasBegin}`
    );
    out.push(...declareLines);
    conversions += 1;

    if (asHasBegin) {
      out.push(`${indent}BEGIN`);
      if (bodySuffix) {
        out.push(indent ? `${indent}${bodySuffix}` : bodySuffix);
      }
    } else if (i < lines.length && lines[i].trim().toUpperCase() === "BEGIN") {
      out.push(lines[i]);
      i += 1;
    }
  }

  emitLog(
    onDetail,
    "convertCreateProcedureToDeclares",
    `CREATE PROC conversion: ${conversions} procedure header(s) inlined`
  );
  return out.join("\n");
}

export function prepareForAnalysis(
  sql: string,
  options?: { stripPreamble?: boolean; onDetail?: LogCallback }
): string {
  const stripPreamble = options?.stripPreamble !== false;
  if (stripPreamble) {
    emitLog(options?.onDetail, "prepareForAnalysis", "stripping deploy preamble");
    sql = stripDeployPreamble(sql, options?.onDetail);
  }
  return sql;
}

export function prepareForTransform(
  sql: string,
  options?: {
    stripPreamble?: boolean;
    inlineProcParams?: boolean;
    onDetail?: LogCallback;
  }
): string {
  const stripPreamble = options?.stripPreamble !== false;
  const inlineProcParams = options?.inlineProcParams !== false;
  if (stripPreamble) {
    emitLog(options?.onDetail, "prepareForTransform", "stripping deploy preamble");
    sql = stripDeployPreamble(sql, options?.onDetail);
  }
  if (inlineProcParams) {
    emitLog(
      options?.onDetail,
      "prepareForTransform",
      "converting CREATE PROCEDURE to DECLARE"
    );
    sql = convertCreateProcedureToDeclares(sql, options?.onDetail);
  }
  return sql;
}

export function stripGoBatches(sql: string, onDetail?: LogCallback): string {
  const lines: string[] = [];
  let removed = 0;
  for (const [lineNo, line] of sql.split(/\r?\n/).entries()) {
    if (/^\s*GO\s*(--.*)?$/i.test(line.trim())) {
      emitLog(
        onDetail,
        "stripGoBatches",
        `  line ${lineNo + 1}: removed GO batch separator: ${truncateForLog(line)}`
      );
      removed += 1;
      continue;
    }
    lines.push(line);
  }
  emitLog(onDetail, "stripGoBatches", `GO strip: removed ${removed} separator line(s)`);
  return lines.join("\n");
}
