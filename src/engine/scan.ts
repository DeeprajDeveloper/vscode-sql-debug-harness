import {
  BEGIN_CATCH,
  BEGIN_TRY,
  DML_DELETE_CLAUSE,
  DML_INSERT_CONTINUATION,
  DML_INSERT_PAREN,
  DML_START,
  DML_UPDATE_CLAUSE,
  DML_UPDATE_COLUMN_SET,
  END_CATCH,
  END_TRY,
  isLocalObjectDml,
  NEW_STMT_AFTER_DML,
  SUMMARY_MAX_LEN,
} from "./constants";
import { stripBlockCommentsOnLine } from "./comments";
import type { DmlFinding, TryCatchFinding, TsqlScanResult } from "./types";

function lineStartsNewStatement(line: string, dmlKind: string): boolean {
  if (!line.trim()) {
    return false;
  }
  if (dmlKind === "UPDATE" || dmlKind === "MERGE") {
    if (DML_UPDATE_COLUMN_SET.test(line)) {
      return false;
    }
    if (DML_UPDATE_CLAUSE.test(line)) {
      return false;
    }
  }
  if (dmlKind === "INSERT") {
    if (DML_INSERT_CONTINUATION.test(line)) {
      return false;
    }
    if (DML_INSERT_PAREN.test(line)) {
      return false;
    }
  }
  if (dmlKind === "DELETE") {
    if (DML_DELETE_CLAUSE.test(line)) {
      return false;
    }
  }
  return NEW_STMT_AFTER_DML.test(line);
}

export function findDmlBlockEnd(lines: string[], start: number): number {
  const dmlKind = lines[start].trim().split(/\s+/)[0].toUpperCase();
  let i = start;
  while (i < lines.length) {
    if (lines[i].includes(";")) {
      return i;
    }
    if (i > start) {
      if (lineStartsNewStatement(lines[i], dmlKind)) {
        return i - 1;
      }
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) {
        j += 1;
      }
      if (j < lines.length && lineStartsNewStatement(lines[j], dmlKind)) {
        return i;
      }
    }
    if (i === lines.length - 1) {
      return i;
    }
    i += 1;
  }
  return start;
}

function findDmlStatements(lines: string[]): DmlFinding[] {
  const findings: DmlFinding[] = [];
  let inBlockComment = false;
  let i = 0;
  while (i < lines.length) {
    const [effective, nextInBlock] = stripBlockCommentsOnLine(
      lines[i],
      inBlockComment
    );
    inBlockComment = nextInBlock;
    if (!effective.trim()) {
      i += 1;
      continue;
    }
    if (!DML_START.test(effective)) {
      i += 1;
      continue;
    }
    if (isLocalObjectDml(effective)) {
      i += 1;
      continue;
    }

    const start = i;
    const end = findDmlBlockEnd(lines, start);
    const kind = effective.trim().split(/\s+/)[0].toUpperCase();
    findings.push({
      kind,
      startLine: start + 1,
      endLine: end + 1,
      text: lines.slice(start, end + 1).join("\n"),
    });
    i = end + 1;
  }
  return findings;
}

function tryCatchEvents(lines: string[]): Array<[string, number]> {
  const events: Array<[string, number]> = [];
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
    if (BEGIN_TRY.test(effective)) {
      events.push(["BEGIN TRY", lineNo]);
    }
    if (END_TRY.test(effective)) {
      events.push(["END TRY", lineNo]);
    }
    if (BEGIN_CATCH.test(effective)) {
      events.push(["BEGIN CATCH", lineNo]);
    }
    if (END_CATCH.test(effective)) {
      events.push(["END CATCH", lineNo]);
    }
  }
  return events;
}

function findTryCatchBlocks(lines: string[]): TryCatchFinding[] {
  const events = tryCatchEvents(lines);
  const findings: TryCatchFinding[] = [];
  let idx = 0;
  let pos = 0;
  while (pos < events.length) {
    if (events[pos][0] !== "BEGIN TRY") {
      pos += 1;
      continue;
    }
    const tryLine = events[pos][1];
    let endTryLine = 0;
    let catchLine = 0;
    let endCatchLine = 0;
    pos += 1;
    while (pos < events.length && events[pos][0] !== "END TRY") {
      pos += 1;
    }
    if (pos >= events.length) {
      break;
    }
    endTryLine = events[pos][1];
    pos += 1;

    while (pos < events.length && events[pos][0] !== "BEGIN CATCH") {
      pos += 1;
    }
    if (pos >= events.length) {
      break;
    }
    catchLine = events[pos][1];
    pos += 1;

    while (pos < events.length && events[pos][0] !== "END CATCH") {
      pos += 1;
    }
    if (pos >= events.length) {
      break;
    }
    endCatchLine = events[pos][1];
    pos += 1;

    idx += 1;
    findings.push({
      index: idx,
      tryLine,
      endTryLine,
      catchLine,
      endCatchLine,
    });
  }
  return findings;
}

function countTryCatchKeywords(
  lines: string[]
): [number, number, number, number] {
  let beginTry = 0;
  let endTry = 0;
  let beginCatch = 0;
  let endCatch = 0;
  for (const [kind] of tryCatchEvents(lines)) {
    if (kind === "BEGIN TRY") {
      beginTry += 1;
    } else if (kind === "END TRY") {
      endTry += 1;
    } else if (kind === "BEGIN CATCH") {
      beginCatch += 1;
    } else if (kind === "END CATCH") {
      endCatch += 1;
    }
  }
  return [beginTry, endTry, beginCatch, endCatch];
}

export function summarizeDml(finding: DmlFinding, maxLen = SUMMARY_MAX_LEN): string {
  let oneLine = finding.text.replace(/\s+/g, " ").trim();
  if (oneLine.length > maxLen) {
    oneLine = oneLine.slice(0, maxLen - 3) + "...";
  }
  return `L${finding.startLine}: ${oneLine}`;
}

export function summarizeTryCatch(finding: TryCatchFinding): string {
  return `#${finding.index} L${finding.tryLine}-L${finding.endCatchLine}: BEGIN TRY (L${finding.tryLine}) ... END CATCH (L${finding.endCatchLine})`;
}

export function scanTsql(sql: string): TsqlScanResult {
  const lines = sql.split(/\r?\n/);
  const dmlFindings = findDmlStatements(lines);
  const tryCatchFindings = findTryCatchBlocks(lines);
  const [beginTry, endTry, beginCatch, endCatch] = countTryCatchKeywords(lines);

  const notes: string[] = [];
  if (beginTry !== endTry || beginCatch !== endCatch) {
    notes.push(
      `[ScanWarning] Unbalanced TRY/CATCH keywords (BEGIN TRY=${beginTry}, END TRY=${endTry}, BEGIN CATCH=${beginCatch}, END CATCH=${endCatch}).`
    );
  }

  return {
    insert: dmlFindings.filter((f) => f.kind === "INSERT").length,
    update: dmlFindings.filter((f) => f.kind === "UPDATE").length,
    delete: dmlFindings.filter((f) => f.kind === "DELETE").length,
    merge: dmlFindings.filter((f) => f.kind === "MERGE").length,
    tryCatchBlocks: tryCatchFindings.length,
    beginTry,
    endTry,
    beginCatch,
    endCatch,
    dmlFindings,
    tryCatchFindings,
    notes,
  };
}

export function scanHasStructure(scan: TsqlScanResult): boolean {
  return (
    scan.insert +
      scan.update +
      scan.delete +
      scan.merge +
      scan.tryCatchBlocks >
    0
  );
}
