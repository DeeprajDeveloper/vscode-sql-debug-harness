/**
 * Optional AST helper via node-sql-parser (TransactSQL).
 * Real enterprise procs often fail to parse; callers must rely on text-scan.
 */

import type { LogCallback } from "./types";
import { emitLog, truncateForLog } from "./log";
import { stripGoBatches } from "./prepare";

export interface ParserAttempt {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Soft note when AST fails but text-scan can continue. */
  parseError?: string;
  /** Raw AST when parse succeeds (opaque to callers). */
  ast: unknown;
}

export function tryParseTransactSql(
  sql: string,
  onDetail?: LogCallback
): ParserAttempt {
  const prepared = stripGoBatches(sql, onDetail);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Parser } = require("node-sql-parser/build/transactsql") as {
      Parser: new () => { astify: (s: string) => unknown };
    };
    const parser = new Parser();
    const ast = parser.astify(prepared);
    emitLog(onDetail, "tryParseTransactSql", "node-sql-parser: parse succeeded");
    return { ok: true, errors: [], warnings: [], ast };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    emitLog(
      onDetail,
      "tryParseTransactSql",
      `node-sql-parser failed (falling back to text scan): ${truncateForLog(message)}`
    );
    return {
      ok: false,
      errors: [],
      warnings: [],
      ast: null,
      parseError: truncateForLog(message, 200),
    };
  }
}
