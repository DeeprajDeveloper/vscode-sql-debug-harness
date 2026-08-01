/** Shared regex patterns for T-SQL text scanning and transforms. */

export const SUMMARY_MAX_LEN = 120;

export const GO_PATTERN = /^\s*GO\s*(--.*)?$/im;

export const DML_START = /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i;
export const INSERT_TABLE_VAR = /^\s*INSERT\s+INTO\s+@/i;
export const UPDATE_TABLE_VAR = /^\s*UPDATE\s+@/i;
export const DELETE_TABLE_VAR = /^\s*DELETE\s+FROM\s+@/i;
/** Local/global temp tables (#t / ##t) — session-scoped, safe to keep live in harness. */
export const INSERT_TEMP_TABLE = /^\s*INSERT\s+(?:INTO\s+)?\[?#/i;
export const UPDATE_TEMP_TABLE = /^\s*UPDATE\s+\[?#/i;
export const DELETE_TEMP_TABLE = /^\s*DELETE\s+(?:FROM\s+)?\[?#/i;

/** Table-variable or temp-table DML — leave intact (no real table side effects). */
export function isLocalObjectDml(firstLine: string): boolean {
  return (
    INSERT_TABLE_VAR.test(firstLine) ||
    UPDATE_TABLE_VAR.test(firstLine) ||
    DELETE_TABLE_VAR.test(firstLine) ||
    INSERT_TEMP_TABLE.test(firstLine) ||
    UPDATE_TEMP_TABLE.test(firstLine) ||
    DELETE_TEMP_TABLE.test(firstLine)
  );
}

export const NEW_STMT_AFTER_DML =
  /^\s*(INSERT|UPDATE|DELETE|MERGE|SET\s+@|BEGIN|END\b|DECLARE|SELECT\b|IF\b|WHILE\b|PRINT\b|RETURN\b|THROW\b|RAISERROR\b|COMMIT\b|ROLLBACK\b|GOTO\b|EXEC\b|EXECUTE\b|SAVE\s+TRAN)/i;

export const EXEC_START =
  /^\s*(?:EXEC|EXECUTE)\s+(?:(?<ret>@\w+)\s*=\s*)?(?<proc>(?!\()[^\s;(]+)(?<rest>.*)$/i;
export const EXEC_PARAM_LINE = /^\s*@?\w+\s*=/i;
export const EXEC_DYNAMIC = /^\s*(?:EXEC|EXECUTE)\s*\(/i;

export const DML_UPDATE_COLUMN_SET = /^\s+SET\s+(?!@)/i;
export const DML_UPDATE_CLAUSE =
  /^\s+(FROM|WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|OUTPUT)\b/i;
export const DML_INSERT_CONTINUATION = /^\s+(VALUES|SELECT|DEFAULT)\b/i;
export const DML_INSERT_PAREN = /^\s*\(/;
export const DML_DELETE_CLAUSE = /^\s+(FROM|WHERE|JOIN|OUTPUT)\b/i;

export const INSERT_TARGET = /INSERT\s+INTO\s+(\S+)/i;
export const UPDATE_TARGET = /UPDATE\s+(\S+)/i;
export const DELETE_TARGET = /DELETE\s+FROM\s+(\S+)/i;
export const MERGE_TARGET = /MERGE\s+(\S+)/i;
export const DELETE_FROM_CLAUSE = /FROM\s+(\S+)/i;

export const BEGIN_TRY = /\bBEGIN\s+TRY\b/i;
export const END_TRY = /\bEND\s+TRY\b/i;
export const BEGIN_CATCH = /\bBEGIN\s+CATCH\b/i;
export const END_CATCH = /\bEND\s+CATCH\b/i;

export const INLINE_SET =
  /(?<indent>^|\n)(?<prefix>.*?)(?<stmt>SET\s+(?<var>@\w+)\s*=[^\n;]+(?:;)?)/gis;
export const SELECT_ASSIGN = /(?<stmt>SELECT\s+[^;]*@\w+\s*=[^;]+;)/gis;
export const SET_VAR_LINE = /^(\s*)SET\s+(@\w+)\s*=/i;
export const SET_NOCOUNT = /^\s*SET\s+NOCOUNT\b/i;
export const ALREADY_STUBBED =
  /\[DBG-PREVIEW\]|\[DBG-DISABLED\]|\[DBG-EXEC\]|\[DBG-TCL\]|\[DBG\]\s+Skipped/i;
export const LINE_INDENT = /^(\s*)/;

export const CLAUSE_FROM = /\bFROM\b/i;
export const CLAUSE_WHERE = /\bWHERE\b/i;
export const CLAUSE_SET = /\bSET\b/i;
export const INSERT_INTO_LINE = /^\s*INSERT\s+INTO\s+(\S+)/i;
export const DELETE_FROM_LINE =
  /^\s*DELETE\s+FROM\s+(\S+)(?:\s+WHERE\s+(.+))?\s*;?\s*$/is;
export const BARE_VAR = /^@\w+$/i;
export const QUOTED_LITERAL = /^(N?'([^']|'')*'|\d+(\.\d+)?)$/i;
export const CALCULATION_PATTERN = /[\+\-\*/%]|^\w+\(/i;

export const IF_EXISTS = /^\s*IF\s+EXISTS\b/i;
export const DROP_PROCEDURE = /\bDROP\s+PROC(?:EDURE)?\b/i;
export const SET_ANSI_NULLS = /^\s*SET\s+ANSI_NULLS\b/i;
export const SET_QUOTED_IDENTIFIER = /^\s*SET\s+QUOTED_IDENTIFIER\b/i;
export const STANDALONE_DROP_PROC = /^\s*DROP\s+PROC(?:EDURE)?\b/i;
export const CREATE_PROC =
  /^\s*CREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+(\S+)/i;
export const CREATE_PROC_INLINE =
  /^\s*CREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+(\S+)\s+(.+)$/i;
export const AS_LINE = /^\s*(?:\)\s*)?AS\s*(?:BEGIN)?\s*;?\s*$/i;
export const PROC_PARAM_WITH_DEFAULT = /^(@\w+)\s+(.+)\s+=\s*(.+)$/i;
export const PROC_PARAM_PLAIN = /^(@\w+)\s+(.+)$/i;
export const AS_BEGIN_REST = /^\s*AS\s+BEGIN\s*(.*)$/i;

export const TCL_START =
  /^\s*(BEGIN\s+TRAN(?:SACTION)?|COMMIT(?:\s+TRAN(?:SACTION)?)?|ROLLBACK(?:\s+TRAN(?:SACTION)?)?|SAVE\s+TRAN(?:SACTION)?)\b/i;

export const CURSOR_DECLARE = /\bDECLARE\s+\w+\s+CURSOR\b/i;
export const DYNAMIC_SQL =
  /\b(?:EXEC|EXECUTE)\s*\(|\bsp_executesql\b/i;
export const WHILE_STMT = /^\s*WHILE\b/i;
export const IF_STMT = /^\s*IF\b/i;
export const SET_ASSIGN = /^\s*SET\s+@\w+\s*=/i;
export const SELECT_VAR_ASSIGN = /^\s*SELECT\b[^;]*@\w+\s*=/i;
