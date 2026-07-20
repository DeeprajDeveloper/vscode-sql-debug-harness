import {
  EXEC_DYNAMIC,
  EXEC_PARAM_LINE,
  EXEC_START,
  NEW_STMT_AFTER_DML,
} from "./constants";

export interface ParsedExec {
  procName: string;
  returnVar: string | null;
  params: Array<[string, string]>;
  commandSql: string;
}

function lineStartsNewStatement(line: string): boolean {
  return NEW_STMT_AFTER_DML.test(line);
}

function isExecContinuation(line: string): boolean {
  return EXEC_PARAM_LINE.test(line);
}

export function findExecBlockEnd(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length) {
    if (lines[i].includes(";")) {
      return i;
    }
    if (i > start) {
      if (lineStartsNewStatement(lines[i])) {
        return i - 1;
      }
      if (!isExecContinuation(lines[i])) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) {
          j += 1;
        }
        if (j < lines.length && lineStartsNewStatement(lines[j])) {
          return i;
        }
      }
    }
    if (i === lines.length - 1) {
      return i;
    }
    i += 1;
  }
  return start;
}

function splitParamAssignments(text: string): Array<[string, string]> {
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

  const result: Array<[string, string]> = [];
  for (const part of parts) {
    if (!part.includes("=")) {
      continue;
    }
    const eq = part.indexOf("=");
    let name = part.slice(0, eq).trim();
    if (!name.startsWith("@")) {
      name = "@" + name.replace(/^@+/, "");
    }
    const value = part.slice(eq + 1).trim().replace(/,+$/, "");
    result.push([name, value]);
  }
  return result;
}

export function parseExecBlock(blockLines: string[]): ParsedExec | null {
  if (!blockLines.length) {
    return null;
  }
  if (EXEC_DYNAMIC.test(blockLines[0])) {
    return null;
  }

  const first = blockLines[0].trim();
  const match = EXEC_START.exec(first);
  if (!match || !match.groups) {
    return null;
  }

  const procName = match.groups.proc.replace(/[,;]+$/, "");
  if (!procName || procName.toLowerCase() === "sp_executesql") {
    return null;
  }

  const returnVar = match.groups.ret || null;
  const params = splitParamAssignments((match.groups.rest || "").trim());
  for (const line of blockLines.slice(1)) {
    const stripped = line.trim().replace(/,+$/, "");
    if (stripped && isExecContinuation(line)) {
      params.push(...splitParamAssignments(stripped));
    }
  }

  let commandSql = returnVar
    ? `EXEC ${returnVar} = ${procName}`
    : `EXEC ${procName}`;
  if (params.length) {
    const paramSql = params.map(([n, v]) => `${n} = ${v}`).join(", ");
    commandSql = `${commandSql} ${paramSql}`;
  }

  return { procName, returnVar, params, commandSql };
}

function paramValuePrint(name: string, value: string, indent: string): string {
  if (/^@\w+$/i.test(value)) {
    return `${indent}PRINT CONCAT(N'[DBG-EXEC] ${name} = ', CAST(${value} AS NVARCHAR(4000)));`;
  }
  return `${indent}PRINT N'[DBG-EXEC] ${name} = ${value}';`;
}

export function buildExecStub(
  blockLines: string[],
  indent: string
): string[] | null {
  const parsed = parseExecBlock(blockLines);
  if (!parsed) {
    return null;
  }

  const lines = [
    `${indent}-- [DBG-EXEC] Would have executed stored procedure ${parsed.procName}`,
    `${indent}PRINT N'[DBG-EXEC] Procedure: ${parsed.procName}';`,
    `${indent}PRINT N'[DBG-EXEC] Command: ${parsed.commandSql}';`,
  ];
  if (parsed.params.length) {
    lines.push(`${indent}PRINT N'[DBG-EXEC] Parameters:';`);
    for (const [name, value] of parsed.params) {
      lines.push(paramValuePrint(name, value, indent));
    }
  }
  return lines;
}
