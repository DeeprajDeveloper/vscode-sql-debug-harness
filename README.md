# SQL SP Harness — VS Code Extension

**Documentation:** [deeprajdeveloper.github.io/vscode-sql-sp-harness](https://deeprajdeveloper.github.io/vscode-sql-sp-harness/) · [Technical design](docs/TECHNICAL_DESIGN.md)

Statically rewrite a T-SQL stored procedure into a **safe debug script**: DML becomes `SELECT` previews, transactions are neutralized, and variables are traced with `PRINT` / `RAISERROR` — so you can run the script without mutating real tables.

> **Not a live debugger.** This generates a static harness script — no breakpoints or step-into on SQL Server.

**No Python required.** The transform engine runs in-process inside the extension (TypeScript). Install from the Marketplace (or a VSIX) and go.

---

## Before / after

**Input**

```sql
CREATE PROCEDURE dbo.usp_SimpleDml
    @Id INT,
    @Name NVARCHAR(100)
AS
BEGIN
    INSERT INTO dbo.Items (Id, Name) VALUES (@Id, @Name);
    UPDATE dbo.Items SET Name = @Name WHERE Id = @Id;
    DELETE FROM dbo.Items WHERE Id = @Id;
END
```

**Generated debug script** (excerpt)

```sql
-- [DBG] Harness: was CREATE PROCEDURE dbo.usp_SimpleDml; set parameter values below.
DECLARE @Id INT = NULL;  -- TODO: set test value
DECLARE @Name NVARCHAR(100) = NULL;  -- TODO: set test value
BEGIN
    -- [DBG-PREVIEW] Would have executed:
    SELECT N'INSERT to table dbo.Items' AS [DBG_Action], @Id AS [@Id], @Name AS [@Name];
    -- [DBG-PREVIEW] Would have executed:
    SELECT N'UPDATE to table dbo.Items' AS [DBG_Action], @Name AS [@Name]
    FROM dbo.Items
    WHERE Id = @Id;
    -- [DBG-PREVIEW] Would have executed:
    SELECT N'DELETE from table dbo.Items' AS [DBG_Action], *
    FROM dbo.Items
    WHERE Id = @Id;
END
```

---

## Quickstart (< 5 minutes)

1. Install **SQL SP Harness** from the VS Code Marketplace (or `code --install-extension dist/sql-sp-harness.vsix`).
2. Open [`samples/fixtures/simple_dml.sql`](samples/fixtures/simple_dml.sql) (or any `.sql` stored procedure).
3. Right-click → **SQL SP Harness** → **Generate Debug Script**.
4. Review the untitled SQL document — DML is preview-only; set `DECLARE` values and run against a safe connection.

Optional: **Analyze Procedure** opens a Summary / Warnings / Identified panel beside the editor.

---

### Open from the sidebar

Click the **SQL SP Harness** icon in the primary activity bar (left). The Workbench view includes an **Open Workbench** button, plus Analyze / Generate actions in the view title bar.

**Loading SQL:** use **Select File…** in the workbench (Quick Pick of workspace `.sql` files), **Load Active** for the open editor, or right-click a file → **Open in Workbench**.

## Commands

| Command | Action |
|---------|--------|
| **Open Workbench** | Open the workbench anytime (empty, or with the active SQL file/selection) |
| **Generate Debug Script** | Build harness script and show it in the **Workbench** |
| **Analyze Procedure** | Run analysis and show it in the **Workbench** |
| **Configure Settings** | Interactive settings picker |

The **Workbench** shows:

- **Source** — selected text or full `.sql` file (**Select File…** or **Load Active**)
- **Debug script** — generated harness (when available)
- **Analysis** — collapsible Summary / Warnings / Identified sections (whole pane can collapse)
- **Active log** — step-by-step engine log (collapsible)

Panes are **resizable** (drag the splitters). Collapse state for Analysis / Active log is **remembered**. Source and Debug previews use **T-SQL syntax highlighting** that follows theme colors. Colors follow the **current IDE theme** (light/dark/high-contrast).

From the toolbar you can **Analyze**, **Generate Debug**, and **save each artifact individually** (analysis `.txt`, debug `.sql`, log `.log`), or open the debug script in a normal editor tab.

Available from the **SQL SP Harness** right-click submenu on `.sql` files and from the Command Palette. Non-empty editor selections are used when present.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `spDebug.traceStyle` | `print` | `print` or `raiserror` for variable traces |
| `spDebug.logToOutput` | `true` | Show step log in the **SQL SP Harness** output channel |
| `spDebug.saveLogFile` | `false` | Also write `<proc>.log` beside the source `.sql` |
| `spDebug.quietWhenLogging` | `true` | Avoid duplicating progress lines when the step log is enabled |

---

## Limitations (trust boundary)

This tool prioritizes **correctness over coverage**. If something cannot be rewritten safely, it is flagged — not silently left as live DML.

- **T-SQL only** for v1 (no PostgreSQL / Oracle / MySQL dialects yet).
- **Static rewrite only** — not a live/step-through debugger.
- **Dynamic SQL** (`EXEC(@sql)`, `sp_executesql`) is detected and warned; not rewritten.
- **Cursors / `WHILE`** — detected and warned; rewriting inside them is best-effort.
- **`MERGE` / `OUTPUT`** — flagged; MERGE is disabled rather than incorrectly previewed.
- **Stored procedures** are the target — not arbitrary ad-hoc DDL/DML scripts.
- **No live DB connection** in the extension — generate the script, then run it yourself (e.g. in SSMS / Azure Data Studio).

---

## Why no Python backend?

Earlier versions shelled out to a PyPI package (`sql-sp-harness`). That forced every user to have Python on PATH, survive first-run `pip install`, and deal with corporate lockdown / wrong interpreters. VS Code already runs Node.js, so the engine was ported to TypeScript and ships **inside the VSIX**. Installing the extension is the entire setup.

The engine uses a **hybrid** approach: optional AST via `node-sql-parser` (TransactSQL) plus the proven text-scan / regex transforms for real enterprise T-SQL (`TRY/CATCH`, multi-line DML, etc.) where full AST parsing often fails.

## Optional CLI (`npx`)

Same engine, outside the editor:

```bash
npx sql-sp-harness generate -i MyProc.sql -o MyProc_debug.sql
npx sql-sp-harness analyze -i MyProc.sql
```

(When developing from this repo: `npm run compile && node out/cli.js generate -i …`.)

## Local development

```bash
git clone https://github.com/DeeprajDeveloper/vscode-sql-sp-harness.git
cd vscode-sql-sp-harness
npm install
npm test
npm run compile
```

Press **F5** to launch an Extension Development Host.

### Package a VSIX

```bash
npm run package
code --install-extension dist/sql-sp-harness.vsix
```

## Roadmap

- v2 ideas: optional connect-and-run inside `BEGIN…ROLLBACK`, richer control-flow handling, and multi-dialect support (the parser stack already spans multiple SQL dialects).

## License

MIT
