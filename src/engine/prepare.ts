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

/** Strip a single outer `( ... )` wrapping a parameter list, or a dangling leading `(`. */
function stripOuterParamParens(text: string): string {
  let t = text.trim();
  if (!t.startsWith("(")) {
    return t;
  }
  let depth = 0;
  let inString = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "'") {
      if (inString && i + 1 < t.length && t[i + 1] === "'") {
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        if (i === t.length - 1) {
          return t.slice(1, i).trim();
        }
        break;
      }
    }
  }
  // Dangling leading "(" (closing paren lived on its own line) — drop it.
  t = t.replace(/^\(\s*/, "").replace(/\s*\)$/, "").trim();
  return t;
}

function splitParamList(text: string): string[] {
  const normalized = stripOuterParamParens(text);
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of normalized) {
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

type ParsedParam = {
  name: string;
  typeSql: string;
  defaultVal: string | null;
  isOutput: boolean;
};

/** Remove OUTPUT / OUT / READONLY and stray trailing commas/semicolons from type or default text. */
function scrubParamTypeOrDefault(raw: string): {
  text: string;
  isOutput: boolean;
} {
  let text = raw.trim().replace(/[,;]+$/g, "").trim();
  let isOutput = false;
  // Trailing modifiers: OUTPUT | OUT | READONLY (order varies in the wild)
  const modRe =
    /(?:^|\s+)(?:OUTPUT|OUT|READONLY)\b/gi;
  const found = text.match(modRe);
  if (found) {
    isOutput = found.some((m) => /\bOUT(PUT)?\b/i.test(m));
    text = text.replace(modRe, " ").replace(/\s+/g, " ").trim();
  }
  text = text.replace(/[,;]+$/g, "").trim();
  return { text, isOutput };
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

function parseParameterChunks(chunks: string[]): ParsedParam[] {
  const params: ParsedParam[] = [];
  for (const chunk of chunks) {
    // Org scripts often end a param with `;` or include OUTPUT — strip before parse.
    const text = chunk.trim().replace(/[,;]+$/g, "").trim();
    if (!text || !text.startsWith("@")) {
      continue;
    }
    let match = PROC_PARAM_WITH_DEFAULT.exec(text);
    if (match) {
      const typePart = scrubParamTypeOrDefault(match[2]);
      const defPart = scrubParamTypeOrDefault(match[3]);
      params.push({
        name: match[1],
        typeSql: typePart.text,
        defaultVal: defPart.text || null,
        isOutput: typePart.isOutput || defPart.isOutput,
      });
      continue;
    }
    match = PROC_PARAM_PLAIN.exec(text);
    if (match) {
      const typePart = scrubParamTypeOrDefault(match[2]);
      params.push({
        name: match[1],
        typeSql: typePart.text,
        defaultVal: null,
        isOutput: typePart.isOutput,
      });
    }
  }
  return params;
}

function declareLinesForParams(
  procName: string,
  params: ParsedParam[],
  indent: string
): string[] {
  const header = `${indent}-- [DBG] Harness: was CREATE PROCEDURE ${procName}; set parameter values below.`;
  if (params.length === 0) {
    return [header, `${indent}-- (no parameters)`];
  }
  // One DECLARE with comma-separated variables (no semicolon between params).
  const lines = [header];
  params.forEach((param, index) => {
    const isLast = index === params.length - 1;
    const sep = isLast ? ";" : ",";
    const notes: string[] = [];
    if (param.isOutput) {
      notes.push("OUTPUT");
    }
    if (!param.defaultVal) {
      notes.push("TODO: set test value");
    }
    const comment = notes.length ? `  -- ${notes.join(" — ")}` : "";
    const value = param.defaultVal ?? "NULL";
    const prefix = index === 0 ? `${indent}DECLARE ` : `${indent}        `;
    lines.push(
      `${prefix}${param.name} ${param.typeSql} = ${value}${sep}${comment}`
    );
  });
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
        const raw = lines[i];
        const trimmed = raw.trim();
        // Opening/closing paren alone (common around param lists) — skip.
        if (trimmed === "(" || trimmed === ")") {
          i += 1;
          continue;
        }
        if (AS_LINE.test(raw)) {
          asHasBegin = /\bBEGIN\b/i.test(raw);
          i += 1;
          break;
        }
        // Line like ") AS" / ") AS BEGIN" — treat as AS, drop the paren.
        const closeAs = /^\s*\)\s*(AS(?:\s+BEGIN)?)\s*;?\s*$/i.exec(raw);
        if (closeAs) {
          asHasBegin = /\bBEGIN\b/i.test(closeAs[1]);
          i += 1;
          break;
        }
        paramParts.push(trimmed);
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
