import {
  CURSOR_DECLARE,
  EXEC_DYNAMIC,
  WHILE_STMT,
} from "./constants";
import { stripBlockCommentsOnLine } from "./comments";

export interface UnsupportedFinding {
  kind: "dynamic_sql" | "cursor" | "while" | "output_clause" | "merge";
  line: number;
  message: string;
}

/** Detect constructs MVP1 cannot safely rewrite. */
export function detectUnsupported(sql: string): UnsupportedFinding[] {
  const findings: UnsupportedFinding[] = [];
  const lines = sql.split(/\r?\n/);
  let inBlockComment = false;
  let inDmlBlock = false;

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

    if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(effective)) {
      inDmlBlock = true;
    }

    if (EXEC_DYNAMIC.test(effective) || /\bsp_executesql\b/i.test(effective)) {
      findings.push({
        kind: "dynamic_sql",
        line: lineNo,
        message: `L${lineNo}: Dynamic SQL detected (EXEC(...) / sp_executesql) — not rewritten; review manually.`,
      });
    }

    if (CURSOR_DECLARE.test(effective)) {
      findings.push({
        kind: "cursor",
        line: lineNo,
        message: `L${lineNo}: Cursor detected — rewriting inside cursor loops is not guaranteed for MVP1.`,
      });
    }

    if (WHILE_STMT.test(effective)) {
      findings.push({
        kind: "while",
        line: lineNo,
        message: `L${lineNo}: WHILE loop detected — control-flow rewriting is best-effort; verify manually.`,
      });
    }

    if (/^\s*MERGE\b/i.test(effective)) {
      findings.push({
        kind: "merge",
        line: lineNo,
        message: `L${lineNo}: MERGE statement detected — disabled (not converted to SELECT preview).`,
      });
    }

    if (
      /\bOUTPUT\b/i.test(effective) &&
      (inDmlBlock || /^\s*(INSERT|UPDATE|DELETE)\b/i.test(effective))
    ) {
      findings.push({
        kind: "output_clause",
        line: lineNo,
        message: `L${lineNo}: OUTPUT clause present — preview may omit OUTPUT side effects; review manually.`,
      });
    }

    if (effective.includes(";") || /^\s*(BEGIN|END|IF|WHILE|SET|DECLARE|EXEC|EXECUTE|RETURN)\b/i.test(effective)) {
      if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(effective)) {
        inDmlBlock = false;
      }
    }
  }

  return findings;
}
