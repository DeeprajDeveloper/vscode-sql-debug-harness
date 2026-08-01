/**
 * Line-oriented SQL compare for the workbench (source ↔ generated harness).
 * Filters banner / blank / non-DBG comment noise before diffing (option B).
 */

export type DiffKind = "equal" | "add" | "remove";

export interface DiffRow {
  kind: DiffKind;
  /** Present for equal + remove */
  left?: string;
  /** Present for equal + add */
  right?: string;
}

export interface DiffStats {
  equal: number;
  added: number;
  removed: number;
  leftLines: number;
  rightLines: number;
}

const BANNER_NOISE =
  /^--\s*(=+|DEBUG HARNESS|Transformed & Generated|DML (replaced|statements)|EXEC statements|TCL statements|Trace lines|PARSE WARNINGS|Please ensure|DO NOT RUN|Not affiliated)/i;

/** True for lines we omit from the comparison to reduce noise. */
export function isCompareNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) {
    return true;
  }
  // Keep harness markers — those are meaningful additions.
  if (/\[DBG/i.test(t)) {
    return false;
  }
  if (BANNER_NOISE.test(t)) {
    return true;
  }
  // Other full-line SQL comments
  if (/^--/.test(t)) {
    return true;
  }
  return false;
}

export function normalizeCompareKey(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Drop noise lines; keep original text for display. */
export function filterLinesForCompare(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => !isCompareNoiseLine(line));
}

/**
 * Classic LCS line diff. Fine for typical stored-proc sizes.
 * Equality uses {@link normalizeCompareKey}.
 */
export function diffLines(left: string[], right: string[]): DiffRow[] {
  const n = left.length;
  const m = right.length;
  const keyL = left.map(normalizeCompareKey);
  const keyR = right.map(normalizeCompareKey);

  const dp: Uint16Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Uint16Array(m + 1);
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (keyL[i] === keyR[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (keyL[i] === keyR[j]) {
      rows.push({ kind: "equal", left: left[i], right: right[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "remove", left: left[i] });
      i += 1;
    } else {
      rows.push({ kind: "add", right: right[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ kind: "remove", left: left[i++] });
  }
  while (j < m) {
    rows.push({ kind: "add", right: right[j++] });
  }
  return rows;
}

export function diffSqlForCompare(source: string, debugSql: string): {
  rows: DiffRow[];
  stats: DiffStats;
} {
  const left = filterLinesForCompare(source);
  const right = filterLinesForCompare(debugSql);
  const rows = diffLines(left, right);
  const stats: DiffStats = {
    equal: 0,
    added: 0,
    removed: 0,
    leftLines: left.length,
    rightLines: right.length,
  };
  for (const row of rows) {
    if (row.kind === "equal") {
      stats.equal += 1;
    } else if (row.kind === "add") {
      stats.added += 1;
    } else {
      stats.removed += 1;
    }
  }
  return { rows, stats };
}
