import {
  BARE_VAR,
  CALCULATION_PATTERN,
  CLAUSE_FROM,
  CLAUSE_SET,
  CLAUSE_WHERE,
  DELETE_FROM_LINE,
  INSERT_INTO_LINE,
  QUOTED_LITERAL,
  UPDATE_TARGET,
} from "./constants";

function extractParenContent(
  text: string,
  openIndex: number
): [string, number] | null {
  if (openIndex >= text.length || text[openIndex] !== "(") {
    return null;
  }
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return [text.slice(openIndex + 1, i), i + 1];
      }
    }
  }
  return null;
}

function blockSql(blockLines: string[]): string {
  const parts = blockLines.map((ln) => ln.trim()).filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function findClause(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match ? match.index : null;
}

function splitExpressions(text: string): string[] {
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

function parseAssignments(setClause: string): Array<[string, string]> {
  const assignments: Array<[string, string]> = [];
  for (const part of splitExpressions(setClause)) {
    if (!part.includes("=")) {
      continue;
    }
    const eq = part.indexOf("=");
    assignments.push([part.slice(0, eq).trim(), part.slice(eq + 1).trim()]);
  }
  return assignments;
}

function lhsColumnName(lhs: string): string {
  return lhs.split(".").pop()!.replace(/^\[|\]$/g, "");
}

function isCalculation(expr: string): boolean {
  const text = expr.trim();
  if (BARE_VAR.test(text)) {
    return false;
  }
  if (QUOTED_LITERAL.test(text)) {
    return false;
  }
  return CALCULATION_PATTERN.test(text);
}

function previewColumnAlias(lhs: string, rhs: string): string {
  rhs = rhs.trim();
  if (BARE_VAR.test(rhs)) {
    return `[${rhs}]`;
  }
  const col = lhsColumnName(lhs);
  if (isCalculation(rhs)) {
    return `[calculated-${col}]`;
  }
  return `[${col}]`;
}

function parseUpdate(sql: string): {
  kind: string;
  target: string;
  assignments: Array<[string, string]>;
  fromClause: string;
  whereClause: string;
} | null {
  const text = sql.trim().replace(/;+$/, "");
  if (!UPDATE_TARGET.test(text)) {
    return null;
  }
  const rest = text.replace(/^UPDATE\s+/i, "").trim();
  const setMatch = CLAUSE_SET.exec(rest);
  if (!setMatch) {
    return null;
  }
  const target = rest.slice(0, setMatch.index).trim();
  const afterSet = rest.slice(setMatch.index + setMatch[0].length).trim();
  const fromPos = findClause(afterSet, CLAUSE_FROM);
  const wherePos = findClause(afterSet, CLAUSE_WHERE);
  const stops = [fromPos, wherePos].filter((p): p is number => p !== null);
  const assignEnd = stops.length ? Math.min(...stops) : afterSet.length;
  const assignments = parseAssignments(afterSet.slice(0, assignEnd));
  if (!assignments.length) {
    return null;
  }

  let fromClause = "";
  if (fromPos !== null) {
    const fromEnd =
      wherePos !== null && wherePos > fromPos ? wherePos : afterSet.length;
    fromClause = afterSet.slice(fromPos, fromEnd).trim();
  }

  let whereClause = "";
  if (wherePos !== null) {
    whereClause = afterSet.slice(wherePos).trim();
  }

  return { kind: "UPDATE", target, assignments, fromClause, whereClause };
}

function parseInsert(sql: string): {
  kind: string;
  target: string;
  columns: string[];
  values: string[];
} | null {
  const oneLine = sql.trim().replace(/;+$/, "").replace(/\s+/g, " ");
  const head = INSERT_INTO_LINE.exec(oneLine);
  if (!head) {
    return null;
  }
  const table = head[1];
  let pos = head[0].length;
  while (pos < oneLine.length && /\s/.test(oneLine[pos])) {
    pos += 1;
  }
  let columns: string[] = [];
  if (pos < oneLine.length && oneLine[pos] === "(") {
    const extracted = extractParenContent(oneLine, pos);
    if (extracted) {
      const [colContent, nextPos] = extracted;
      columns = colContent
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      pos = nextPos;
    }
  }

  const valuesMatch = /\bVALUES\b/i.exec(oneLine.slice(pos));
  if (!valuesMatch) {
    return null;
  }
  pos += valuesMatch.index! + valuesMatch[0].length;
  while (pos < oneLine.length && /\s/.test(oneLine[pos])) {
    pos += 1;
  }

  const valuesExtracted = extractParenContent(oneLine, pos);
  if (!valuesExtracted) {
    return null;
  }
  const values = splitExpressions(valuesExtracted[0]);
  if (!values.length) {
    return null;
  }
  if (columns.length && columns.length !== values.length) {
    return null;
  }
  if (!columns.length) {
    columns = values.map((_, i) => `col${i + 1}`);
  }

  return { kind: "INSERT", target: table, columns, values };
}

function parseDelete(sql: string): {
  kind: string;
  target: string;
  whereClause: string;
} | null {
  const oneLine = sql.trim().replace(/;+$/, "").replace(/\s+/g, " ");
  const match = DELETE_FROM_LINE.exec(oneLine);
  if (!match) {
    return null;
  }
  return {
    kind: "DELETE",
    target: match[1],
    whereClause: (match[2] || "").trim(),
  };
}

function formatMultiline(indent: string, sql: string): string[] {
  return sql.split(/\r?\n/).map((line) => (line ? `${indent}${line}` : ""));
}

export function buildDmlPreview(
  blockLines: string[],
  indent: string
): string[] | null {
  const sql = blockSql(blockLines);
  const first = blockLines[0].trim().split(/\s+/)[0].toUpperCase();

  if (first === "UPDATE") {
    const parsed = parseUpdate(sql);
    if (!parsed) {
      return null;
    }
    const selectCols = [`N'UPDATE to table ${parsed.target}' AS [DBG_Action]`];
    for (const [lhs, rhs] of parsed.assignments) {
      selectCols.push(`${rhs} AS ${previewColumnAlias(lhs, rhs)}`);
    }
    const fromSql = parsed.fromClause || `FROM ${parsed.target}`;
    const whereClause = parsed.whereClause.trim();
    const preview =
      `SELECT ${selectCols.join(", ")}\n` +
      fromSql +
      (whereClause ? `\n${whereClause}` : "") +
      ";";
    return [
      `${indent}-- [DBG-PREVIEW] Would have executed:`,
      ...formatMultiline(indent, preview),
    ];
  }

  if (first === "INSERT") {
    const parsed = parseInsert(sql);
    if (!parsed) {
      return null;
    }
    const selectCols = [`N'INSERT to table ${parsed.target}' AS [DBG_Action]`];
    for (let i = 0; i < parsed.columns.length; i++) {
      selectCols.push(
        `${parsed.values[i]} AS ${previewColumnAlias(parsed.columns[i], parsed.values[i])}`
      );
    }
    const preview = `SELECT ${selectCols.join(", ")};`;
    return [
      `${indent}-- [DBG-PREVIEW] Would have executed:`,
      ...formatMultiline(indent, preview),
    ];
  }

  if (first === "DELETE") {
    const parsed = parseDelete(sql);
    if (!parsed) {
      return null;
    }
    const selectCols = [
      `N'DELETE from table ${parsed.target}' AS [DBG_Action]`,
      "*",
    ];
    const preview =
      `SELECT ${selectCols.join(", ")}\n` +
      `FROM ${parsed.target}` +
      (parsed.whereClause ? `\nWHERE ${parsed.whereClause}` : "") +
      ";";
    return [
      `${indent}-- [DBG-PREVIEW] Would have executed:`,
      ...formatMultiline(indent, preview),
    ];
  }

  return null;
}
