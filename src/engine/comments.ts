import type { LogCallback } from "./types";
import { emitLog, truncateForLog } from "./log";

const MAX_DETAIL_LINES = 80;

export function stripLineComment(line: string): string {
  const out: string[] = [];
  let i = 0;
  let inString = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") {
      if (inString && i + 1 < line.length && line[i + 1] === "'") {
        out.push("''");
        i += 2;
        continue;
      }
      inString = !inString;
      out.push(ch);
      i += 1;
      continue;
    }
    if (!inString && ch === "-" && i + 1 < line.length && line[i + 1] === "-") {
      break;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

export function stripBlockCommentsOnLine(
  line: string,
  inBlockComment: boolean
): [string, boolean] {
  if (inBlockComment) {
    const end = line.indexOf("*/");
    if (end === -1) {
      return ["", true];
    }
    line = line.slice(end + 2);
    inBlockComment = false;
  }

  while (true) {
    const start = line.indexOf("/*");
    if (start === -1) {
      break;
    }
    const end = line.indexOf("*/", start + 2);
    if (end === -1) {
      return [stripLineComment(line.slice(0, start)), true];
    }
    line = line.slice(0, start) + line.slice(end + 2);
  }

  return [stripLineComment(line), inBlockComment];
}

export function stripSqlComments(
  sql: string,
  onDetail?: LogCallback
): string {
  const hadTrailingNewline = sql.endsWith("\n");
  const rawLines = sql.split(/\r?\n/);
  emitLog(onDetail, "stripSqlComments", `Comment strip: scanning ${rawLines.length} line(s)`);

  let inBlockComment = false;
  const kept: string[] = [];
  let removedLineCount = 0;
  let modifiedLineCount = 0;
  let detailBudget = MAX_DETAIL_LINES;

  for (let lineNo = 0; lineNo < rawLines.length; lineNo++) {
    const raw = rawLines[lineNo];
    const prevInBlock = inBlockComment;
    const [effective, nextInBlock] = stripBlockCommentsOnLine(raw, inBlockComment);
    inBlockComment = nextInBlock;
    const stripped = effective.replace(/\s+$/, "");
    const changed = effective !== raw || prevInBlock !== inBlockComment;

    if (changed && detailBudget > 0) {
      emitLog(
        onDetail,
        "stripSqlComments",
        `  line ${lineNo + 1}: stripped comment(s): ${truncateForLog(raw)} -> ${truncateForLog(stripped)}`
      );
      detailBudget -= 1;
      modifiedLineCount += 1;
    }

    if (stripped) {
      kept.push(stripped);
    } else if (raw.trim() || prevInBlock) {
      removedLineCount += 1;
    }
  }

  emitLog(
    onDetail,
    "stripSqlComments",
    `Comment strip done: kept ${kept.length} line(s), removed ${removedLineCount} empty line(s), modified ${modifiedLineCount} line(s)`
  );

  if (kept.length === 0) {
    return hadTrailingNewline ? "\n" : "";
  }
  const body = kept.join("\n");
  return hadTrailingNewline ? body + "\n" : body;
}
