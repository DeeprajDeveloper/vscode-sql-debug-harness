/** Lightweight T-SQL syntax highlighter for workbench previews (HTML spans). */

const KEYWORDS = new Set(
  [
    "add",
    "all",
    "alter",
    "and",
    "any",
    "as",
    "asc",
    "authorization",
    "backup",
    "begin",
    "between",
    "break",
    "browse",
    "bulk",
    "by",
    "cascade",
    "case",
    "check",
    "checkpoint",
    "close",
    "clustered",
    "coalesce",
    "collate",
    "column",
    "commit",
    "compute",
    "constraint",
    "contains",
    "containstable",
    "continue",
    "convert",
    "create",
    "cross",
    "current",
    "current_date",
    "current_time",
    "current_timestamp",
    "current_user",
    "cursor",
    "database",
    "dbcc",
    "deallocate",
    "declare",
    "default",
    "delete",
    "deny",
    "desc",
    "disk",
    "distinct",
    "distributed",
    "double",
    "drop",
    "dump",
    "else",
    "end",
    "errlvl",
    "escape",
    "except",
    "exec",
    "execute",
    "exists",
    "exit",
    "external",
    "fetch",
    "file",
    "fillfactor",
    "for",
    "foreign",
    "freetext",
    "freetexttable",
    "from",
    "full",
    "function",
    "goto",
    "grant",
    "group",
    "having",
    "holdlock",
    "identity",
    "identity_insert",
    "identitycol",
    "if",
    "in",
    "index",
    "inner",
    "insert",
    "intersect",
    "into",
    "is",
    "join",
    "key",
    "kill",
    "left",
    "like",
    "lineno",
    "load",
    "merge",
    "national",
    "nocheck",
    "nonclustered",
    "not",
    "null",
    "nullif",
    "of",
    "off",
    "offsets",
    "on",
    "open",
    "opendatasource",
    "openquery",
    "openrowset",
    "openxml",
    "option",
    "or",
    "order",
    "outer",
    "over",
    "percent",
    "pivot",
    "plan",
    "precision",
    "primary",
    "print",
    "proc",
    "procedure",
    "public",
    "raiserror",
    "read",
    "readtext",
    "reconfigure",
    "references",
    "replication",
    "restore",
    "restrict",
    "return",
    "revert",
    "revoke",
    "right",
    "rollback",
    "rowcount",
    "rowguidcol",
    "rule",
    "save",
    "schema",
    "securityaudit",
    "select",
    "semantickeyphrasetable",
    "semanticsimilaritydetailstable",
    "semanticsimilaritytable",
    "session_user",
    "set",
    "setuser",
    "shutdown",
    "some",
    "statistics",
    "system_user",
    "table",
    "tablesample",
    "textsize",
    "then",
    "to",
    "top",
    "tran",
    "transaction",
    "trigger",
    "truncate",
    "try",
    "catch",
    "tsequal",
    "union",
    "unique",
    "unpivot",
    "update",
    "updatetext",
    "use",
    "user",
    "values",
    "varying",
    "view",
    "waitfor",
    "when",
    "where",
    "while",
    "with",
    "within",
    "writetext",
    "go",
    "nocount",
    "output",
    "inout",
    "out",
    "returns",
    "cast",
    "convert",
    "getdate",
    "getutcdate",
    "isnull",
    "coalesce",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "len",
    "substring",
    "replace",
    "concat",
    "charindex",
    "object_id",
    "newid",
    "row_number",
    "rank",
    "dense_rank",
    "over",
    "partition",
    "apply",
    "cross",
    "outer",
  ].map((k) => k.toLowerCase())
);

const TYPES = new Set(
  [
    "bigint",
    "binary",
    "bit",
    "char",
    "date",
    "datetime",
    "datetime2",
    "datetimeoffset",
    "decimal",
    "float",
    "geography",
    "geometry",
    "hierarchyid",
    "image",
    "int",
    "money",
    "nchar",
    "ntext",
    "numeric",
    "nvarchar",
    "real",
    "smalldatetime",
    "smallint",
    "smallmoney",
    "sql_variant",
    "sysname",
    "text",
    "time",
    "timestamp",
    "tinyint",
    "uniqueidentifier",
    "varbinary",
    "varchar",
    "xml",
  ].map((k) => k.toLowerCase())
);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

/**
 * Highlight T-SQL source as HTML. Input is raw SQL (not pre-escaped).
 */
export function highlightTsql(sql: string): string {
  if (!sql) {
    return "";
  }

  let out = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment --
    if (ch === "-" && next === "-") {
      let j = i + 2;
      while (j < sql.length && sql[j] !== "\n") {
        j += 1;
      }
      out += span("tok-comment", sql.slice(i, j));
      i = j;
      continue;
    }

    // Block comment /* */
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j + 1 < sql.length && !(sql[j] === "*" && sql[j + 1] === "/")) {
        j += 1;
      }
      j = Math.min(sql.length, j + 2);
      out += span("tok-comment", sql.slice(i, j));
      i = j;
      continue;
    }

    // String / N'string'
    if (ch === "'" || (ch.toLowerCase() === "n" && next === "'")) {
      const start = ch.toLowerCase() === "n" ? i : i;
      let j = ch.toLowerCase() === "n" ? i + 2 : i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      out += span("tok-string", sql.slice(start, j));
      i = j;
      continue;
    }

    // Bracketed identifier [name]
    if (ch === "[") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== "]") {
        j += 1;
      }
      if (j < sql.length) {
        j += 1;
      }
      out += span("tok-ident", sql.slice(i, j));
      i = j;
      continue;
    }

    // Variables @name / @@name
    if (ch === "@") {
      let j = i + 1;
      if (j < sql.length && sql[j] === "@") {
        j += 1;
      }
      while (j < sql.length && /[A-Za-z0-9_#$]/.test(sql[j])) {
        j += 1;
      }
      out += span("tok-var", sql.slice(i, j));
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(next || ""))) {
      let j = i;
      while (j < sql.length && /[0-9.]/.test(sql[j])) {
        j += 1;
      }
      if (j < sql.length && /[eE]/.test(sql[j])) {
        j += 1;
        if (j < sql.length && /[+-]/.test(sql[j])) {
          j += 1;
        }
        while (j < sql.length && /[0-9]/.test(sql[j])) {
          j += 1;
        }
      }
      out += span("tok-number", sql.slice(i, j));
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_#]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_#$]/.test(sql[j])) {
        j += 1;
      }
      const word = sql.slice(i, j);
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) {
        out += span("tok-keyword", word);
      } else if (TYPES.has(lower)) {
        out += span("tok-type", word);
      } else {
        out += span("tok-ident", word);
      }
      i = j;
      continue;
    }

    // Operators / punctuation / whitespace
    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}
