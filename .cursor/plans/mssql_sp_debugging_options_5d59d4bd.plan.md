---
name: MSSQL SP debugging options
overview: Build a VS Code/Cursor command that transforms a stored procedure into a safe debug script (PRINT on variable changes, DML stubbed). Start with an AST-based transformer spike (ScriptDom or sqlglot), then wrap in a thin extension. VS Code still has no true step debugger; this automates your current SSMS manual workflow.
todos:
  - id: spike-parser
    content: "Phase 0 spike: parse 2–3 real enterprise SPs; list parse errors and node types for SET, IF, WHILE, INSERT/UPDATE/DELETE"
    status: completed
  - id: core-transformer
    content: "Phase 1: implement transformer (DML stubbing + PRINT after assignments) as CLI, input .sql → output _debug.sql"
    status: completed
  - id: vscode-extension
    content: "Phase 2: VS Code extension command (Generate Debug Script) calling CLI; preview diff in new editor tab"
    status: completed
  - id: mvp-limitations-doc
    content: Document known unsupported patterns (dynamic SQL, MERGE, INSERT…EXEC) in extension README
    status: completed
isProject: false
---

# MSSQL SP debug harness utility (plan)

## Your idea — feasibility

**Yes, this is buildable**, and it directly automates what you already do manually in SSMS (comment DML, `PRINT`/`SELECT` variables). It is **not** a debugger (no breakpoints / step-into); it is a **static code transformer** that emits a **safe-to-run debug script**.

Success depends on using a **real T-SQL parser (AST)**, not regex on `BEGIN`/`END`. Nested blocks, strings containing `BEGIN`, `TRY/CATCH`, and `CASE` make brace-matching brittle.

```mermaid
flowchart LR
  input[SP_sql_file_or_selection]
  parse[AST_parser]
  analyze[Visitor_find_nodes]
  transform[Rewrite_AST]
  emit[Formatted_debug_sql]
  vscode[VS_Code_command]
  input --> parse --> analyze --> transform --> emit
  vscode --> input
  emit --> preview[New_editor_tab]
```



---

## Context: VS Code still has no step debugger

The earlier finding stands: no extension provides JS/Python-style stepping inside a live SP on the server. This utility is the practical path — **generate** a harness you run in SSMS or the MSSQL extension.


| Approach                       | What you get                                                          |
| ------------------------------ | --------------------------------------------------------------------- |
| Visual Studio + SSDT debugger  | True breakpoints (on-prem only; often blocked on enterprise clusters) |
| **This utility (planned)**     | Automated safe script: stubbed DML + trace prints                     |
| Manual (your current workflow) | Same outcome, slow and error-prone                                    |


---

## Recommended delivery: VS Code / Cursor extension

You chose: **editor command** (e.g. right-click `.sql` → **Generate Debug Script**).

**Architecture (two layers):**

1. **Core transformer** — standalone CLI/library (testable without VS Code).
2. **Thin VS Code extension** — reads active file/selection, invokes CLI, opens result in a new tab (optional diff view).

Keeping the transformer separate avoids debugging parser logic inside the extension host.

---

## Parser choice (critical decision)


| Option                                                                         | Pros                                                                                      | Cons                                                                            | Recommendation                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| **[Microsoft SqlScriptDOM](https://github.com/microsoft/SqlScriptDOM)** (.NET) | Highest T-SQL fidelity; same family as SSDT/DacFx; can **rewrite** AST and regenerate SQL | C# / `dotnet` dependency; learning curve for visitors                           | **Production target** for enterprise T-SQL        |
| **[sqlglot](https://github.com/tobymao/sqlglot)** (Python, `dialect="tsql"`)   | Fast to spike; good for format/traverse                                                   | Not 100% SQL Server–identical; edge-case parse failures on heavy enterprise SQL | **Phase 0 spike** only, or if team prefers Python |
| Regex / text                                                                   | Quick hack                                                                                | Breaks on real procs                                                            | **Do not use**                                    |


**Suggested path:** 1–2 day **sqlglot or ScriptDom spike** on *your* nastiest proc → pick parser that parses cleanly → implement transformer in that stack → VS Code wraps it.

For a **VS Code extension**, the cleanest long-term shape is:

```
sp-debug-transform.exe   ← C# + ScriptDom (CLI)
sp-debug-vscode/         ← TypeScript extension calls CLI via child_process
```

Alternative: single **Python CLI** + extension if the team already standardizes on Python and sqlglot parses your procs reliably.

---

## What the transformer should do (by phase)

### Phase 0 — Spike (where to start **this week**)

**Goal:** Prove parsing + identification on 2–3 real procedures from your cluster (export from SSMS).

1. Input: full `CREATE PROCEDURE ... AS` script (or body only).
2. Parse → report `ParseError` list (if any).
3. **Inventory pass** (visitor over AST) — print counts only:
  - `BEGIN...END` blocks (compound statements)
  - `IF`, `WHILE`, `TRY/CATCH`
  - `INSERT`, `UPDATE`, `DELETE` (include `MERGE` as stretch)
  - Assignments: `SET @x = ...`, `SELECT @x = ...`, multi-assign `SELECT @a = ..., @b = ...`

**Exit criteria:** ≥90% of your sample procs parse without errors; you have a clear list of AST node types to hook in Phase 1.

**Spike artifact:** small repo folder, e.g. `tools/sp-debug/`, with:

- `samples/` — anonymized proc snippets
- `spike.ps1` or `spike.py` — parse + inventory only (no rewrite yet)

### Phase 1 — MVP transformer (CLI)

**Input:** `.sql` file or stdin  
**Output:** `*_debug.sql` (never overwrite source)


| Feature            | Behavior (MVP)                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Format**         | Pretty-print / normalize indentation (ScriptDom generator or sqlglot `pretty`)                                             |
| **DML safety**     | For each `INSERT`/`UPDATE`/`DELETE`: wrap in block comment **or** replace with stub (see below)                            |
| **Variable trace** | After each `SET @var = ...` and each `SELECT @var = ...` (per column assigned): inject debug line                          |
| **Block markers**  | Prefix `IF` / `WHILE` / major `BEGIN` blocks with comment labels `-- [DBG] Step N: WHILE ...` (optional, helps navigation) |


**DML stubbing strategy (pick one for MVP):**

```sql
-- Option A (safest): comment entire statement + banner
/* [DBG-DISABLED] INSERT INTO dbo.Foo ...
INSERT INTO dbo.Foo (...)
VALUES (...);
*/
PRINT '[DBG] Skipped INSERT dbo.Foo';

-- Option B (more informative): SELECT preview (harder — need table metadata)
-- MVP: Option A only
```

**PRINT injection pattern:**

```sql
SET @Count = @Count + 1;
-- injected:
RAISERROR('[DBG] @Count = %i', 0, 1, @Count) WITH NOWAIT;
-- or: PRINT CONCAT('[DBG] @Count=', @Count);
```

Use `RAISERROR ... WITH NOWAIT` if you want SSMS message order matching execution order (your current pain with buffered `PRINT`).

**Explicit MVP exclusions** (document, do not silently break):

- Dynamic SQL (`EXEC(@sql)`, `sp_executesql`)
- `MERGE` (add in v2)
- `INSERT ... EXEC`
- `UPDATE`/`DELETE` with hints on linked servers / remote
- Cursors (`DECLARE CURSOR` — mark block, do not rewrite inner fetches blindly)
- `CREATE TABLE` / `DROP` / DDL inside proc
- Procedures that are encrypted (`WITH ENCRYPTION`)

### Phase 2 — VS Code / Cursor extension


| Piece      | Detail                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| Command    | `SP Debug: Generate Debug Script`                                        |
| Context    | Active `.sql` editor; optional selection → only transform selection      |
| Output     | New untitled document `MyProc.debug.sql` or side-by-side diff            |
| Config     | `spDebug.stubDml`: `comment`                                             |
| Config     | `spDebug.traceStyle`: `print`                                            |
| Dependency | Bundled CLI or prompt to install `dotnet tool` / Python env on first run |


**package.json** contribution sketch:

- `contributes.commands`: Generate Debug Script
- `contributes.menus`: editor/context when `resourceLangId == sql`

---

## AST implementation notes (ScriptDom-oriented)

ScriptDom visitor targets (examples — exact type names vary by version):

- `InsertStatement`, `UpdateStatement`, `DeleteStatement`
- `SetVariableStatement`, `SelectStatement` (when `SelectScalarExpression` assigns to variables)
- `IfStatement`, `WhileStatement`, `TryCatchStatement`
- `BeginEndBlockStatement` for block structure

**Rewrite approach:**

1. Parse → `TSqlScript`
2. Custom `TSqlFragmentVisitor` collects transform **actions** (insert after node X, replace node Y)
3. Apply actions bottom-up (deepest first) to preserve offsets, **or** mutate AST and call `SqlScriptGenerator` to emit SQL

Microsoft’s [ScriptDom blog samples](https://devblogs.microsoft.com/azure-sql/programmatically-parsing-transact-sql-t-sql-with-the-scriptdom-parser/) show visitor + regenerate pattern.

**Variable assignment detection** is harder than DML:

- `SET @a = @b + 1` — single variable, easy
- `SELECT @a = col, @b = col2 FROM ...` — walk `SelectSetVariable` elements
- `UPDATE @t SET ...` on table variables — do not treat as table DML for stubbing in v1

---

## sqlglot-oriented spike (alternative start)

If you spike in Python first:

```python
import sqlglot
tree = sqlglot.parse_one(sql, read="tsql")
# walk tree.find_all(sqlglot.exp.Insert) etc.
```

Faster iteration; validate output still runs on SQL Server (`sqlglot.transpile(..., write="tsql")`). Move to ScriptDom when sqlglot fails on production procs.

---

## Testing strategy


| Layer        | Tests                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Golden files | Input `.sql` → expected `_debug.sql` snapshots (diff in CI)                                                       |
| Round-trip   | Parsed debug script re-parses without errors                                                                      |
| Manual       | Run generated script on dev cluster; confirm **no row changes** (grep for uncommented `INSERT`/`UPDATE`/`DELETE`) |


Add a **“dry run checklist”** in extension output channel after generate:

- N DML statements stubbed
- N trace lines added
- M parse warnings

---

## Suggested repo layout (when you execute)

```
tools/sp-debug/
  src/SpDebug.Core/          # C# ScriptDom transformer (or python/sp_debug/)
  src/SpDebug.Cli/           # dotnet tool: sp-debug transform -i in.sql -o out.sql
  vscode-sp-debug/           # extension package
  samples/
    simple_proc.sql
    loop_with_update.sql
  tests/golden/
```

---

## Where to start (concrete next steps)

1. **Export one painful proc** from SSMS (full `CREATE PROC` script) → save under `samples/`.
2. **Run Phase 0 spike** — parse + inventory only; note failures.
3. **Choose parser** based on spike (ScriptDom if enterprise SQL is messy for sqlglot).
4. **Implement Phase 1** for one proc end-to-end: DML comment-stub + `RAISERROR` after every `SET @x`.
5. **Wrap Phase 2** VS Code command that shells out to CLI and opens result.

Do **not** start with the VS Code extension UI — start with the **CLI transformer** and golden tests; the editor command is ~50 lines once the core works.

---

## Risks and mitigations


| Risk                              | Mitigation                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Parser fails on valid proc        | Fall back to “partial transform” + warning banner at top of output                      |
| Rewritten SQL behaves differently | MVP only **comments** DML; never auto-`SELECT` from real tables without opt-in          |
| `BEGIN/END` mis-identified        | Use AST blocks only, never text matching                                                |
| Team runs debug script on prod    | Banner `-- DEBUG HARNESS — DO NOT RUN ON PRODUCTION` + optional `-- @Environment check` |


---

## References

- [ScriptDom parsing (Microsoft blog)](https://devblogs.microsoft.com/azure-sql/programmatically-parsing-transact-sql-t-sql-with-the-scriptdom-parser/)
- [SqlScriptDOM repo](https://github.com/microsoft/SqlScriptDOM)
- [sqlglot T-SQL dialect](https://github.com/tobymao/sqlglot)
- [VS Code extension API](https://code.visualstudio.com/api/get-started/your-first-extension)
- Prior plan sections: VS+SSDT debugger, MSSQL extension Query Profiler (observability, not harness generation)

