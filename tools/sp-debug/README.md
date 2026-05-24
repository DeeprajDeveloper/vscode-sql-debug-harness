# sp-debug — MSSQL stored procedure debug harness

Transforms a stored procedure (or T-SQL script) into a **safe debug script** you can run in SSMS or the VS Code MSSQL extension:

- **DML stubbed** — `INSERT` / `UPDATE` / `DELETE` / `MERGE` against real tables are wrapped in block comments and replaced with `RAISERROR ... WITH NOWAIT` skip messages.
- **Variable traces** — after each `SET @var = ...` and `SELECT @var = ...`, injects a trace line (`RAISERROR` or `PRINT`).
- **Table variables preserved** — `INSERT INTO @t`, `UPDATE @t` are left unchanged.

Output files include a **DO NOT RUN ON PRODUCTION** banner and a summary of changes.

## Install

```bash
cd tools/sp-debug
pip install -e ".[dev]"
```

Requires **Python 3.10+**.

## CLI

### Inventory (Phase 0 spike)

```bash
python -m sp_debug inventory -i samples/simple_proc.sql
python scripts/spike.py samples/*.sql
```

### Transform

```bash
python -m sp_debug transform -i samples/simple_proc.sql
# writes samples/simple_proc_debug.sql

python -m sp_debug transform -i my_proc.sql -o /tmp/debug.sql --trace-style print
```

Options:

| Flag | Description |
|------|-------------|
| `--trace-style raiserror` | Default; `RAISERROR(..., 0, 1) WITH NOWAIT` |
| `--trace-style print` | `PRINT CONCAT(...)` |
| `--no-stub-dml` | Only add traces, do not stub DML |
| `--block-markers` | Insert `-- [DBG] Step N` before `IF` / `WHILE` |

## VS Code / Cursor extension

See [`vscode-sp-debug/README.md`](../vscode-sp-debug/README.md).

Or use a workspace task (`.vscode/tasks.json` at repo root).

## Tests

```bash
pytest
```

## Limitations (MVP)

Read this before relying on output on a shared cluster.

### Not transformed safely

| Pattern | Behavior |
|---------|----------|
| **Dynamic SQL** (`EXEC(@sql)`, `sp_executesql`) | Not analyzed; SQL inside strings may still execute |
| **`MERGE`** | May be stubbed by line scanner if recognized; not fully tested |
| **`INSERT ... EXEC`** | Not specially handled |
| **DDL** (`CREATE`, `DROP`, `ALTER`) | Not stubbed |
| **Encrypted procedures** (`WITH ENCRYPTION`) | Cannot read source |
| **Cursors** | Body not rewritten; DML inside may still be stubbed |
| **Linked-server / remote hints** | Not detected |

### Parser / coverage

- Uses [sqlglot](https://github.com/tobymao/sqlglot) for inventory and `SELECT @var =` assignment detection.
- **TRY/CATCH**, nested `BEGIN/END`, and some `IF/ELSE` chains parse as `Command` fragments in sqlglot; **DML stubbing uses line scanning** so `UPDATE dbo.*` inside `TRY` is still caught when it appears as plain text.
- **Table-variable DML** (`INSERT INTO @x`, `UPDATE @x`) is skipped by design.
- Regenerated SQL is **not pretty-printed** end-to-end; structure is preserved with injections.
- Always **review** `_debug.sql` before running; grep for uncommented `INSERT`/`UPDATE`/`DELETE` against production tables.

### Trace noise

- `SET NOCOUNT ON` is not traced.
- Every `SET @var` produces a trace — busy loops can be very verbose; use `--no-stub-dml` or edit output.

### Not a debugger

This tool does **not** step through procedures, set breakpoints, or attach to SQL Server. It only generates a static script. For breakpoint debugging on-premises, see Visual Studio + SSDT (if your organization allows it).

## Project layout

```
tools/sp-debug/
  src/sp_debug/     # Python package
  samples/          # Example procedures
  scripts/spike.py  # Inventory helper
  tests/
vscode-sp-debug/    # Editor extension
```
