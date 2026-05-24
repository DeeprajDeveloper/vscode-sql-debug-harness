# Technical reference — MS-SQL SP Debug Script Generator

## Architecture

Two layers: a **Python CLI** (core logic) and a **thin VS Code extension** (UI).

```
┌─────────────────────┐     ┌──────────────────────┐
│  VS Code extension  │────▶│  sp-debug CLI        │
│  vscode-sp-debug/   │     │  tools/sp-debug/     │
└─────────────────────┘     └──────────┬───────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
              parse.py          transform.py       inventory.py
              t_sql_scan.py       dml_preview.py
              (sqlglot +          (line rewrite +    (AST + scan
               text scan)           SELECT previews)   reports)
```

| Component | Path | Role |
|-----------|------|------|
| CLI entry | `tools/sp-debug/src/sp_debug/cli.py` | `inventory` and `transform` commands |
| Parser | `parse.py` | Strip `GO`, optional sqlglot parse, text scan |
| Transform | `transform.py` | DML preview replacement, PRINT traces |
| DML preview | `dml_preview.py` | Build `SELECT` previews from UPDATE/INSERT/DELETE |
| Text scan | `t_sql_scan.py` | Find DML/TRY-CATCH sqlglot misses |
| Inventory | `inventory.py` | Summary + identified statement tables |
| Extension | `vscode-sp-debug/src/extension.ts` | Spawns CLI, opens output tabs |

**Transform** uses `parse_for_transform()` — text scan only, no full sqlglot parse (faster on large procs). **Inventory** uses full `parse_sql()` plus AST walking.

---

## CLI

Install:

```bash
cd tools/sp-debug && pip install -e ".[dev]"
```

### Transform

```bash
python3 -m sp_debug transform -i input.sql -o output_debug.sql
```

| Flag | Default | Description |
|------|---------|-------------|
| `--trace-style print` | `print` | `PRINT CONCAT` for variable traces |
| `--trace-style raiserror` | | `RAISERROR ... WITH NOWAIT` |
| `--no-stub-dml` | off | Traces only; leave DML unchanged |
| `--block-markers` | off | Insert `-- [DBG] Step N` before IF/WHILE |
| `--quiet` / `-q` | off | Suppress progress on stderr |

**Transform behavior:**

- Real-table DML → `[DBG-PREVIEW]` `SELECT` with `[DBG_Action]` plus column values
- Bare `@var` on RHS → alias `[@var]`; expressions → `[calculated-ColumnName]`
- Table-variable DML (`INSERT INTO @t`) → unchanged
- After each `SET @var` / `SELECT @var =` → trace line
- Banner: `DEBUG HARNESS — DO NOT RUN ON PRODUCTION`

### Inventory

```bash
python3 -m sp_debug inventory -i input.sql
python3 -m sp_debug inventory -i input.sql -r report.txt
python3 -m sp_debug inventory -i input.sql --full    # include zero counts
python3 -m sp_debug inventory -i input.sql --plain   # no ANSI colors
```

Report sections: **Summary** (counts) → **Warnings & Errors** → **Identified** (statement detail).

DML counts merge sqlglot AST + text scan (`max` of each). Details union both sources with deduplication.

### Tests

```bash
cd tools/sp-debug && pytest
```

---

## Parser strategy

| Layer | Library | Used for |
|-------|---------|----------|
| AST | [sqlglot](https://github.com/tobymao/sqlglot) (`read="tsql"`) | Inventory IF/WHILE/SET, some DML |
| Text scan | Custom `t_sql_scan.py` | DML inside TRY/CATCH, UPDATE sqlglot drops |
| Line rewrite | Regex + line blocks in `transform.py` | DML replacement, trace injection |

sqlglot logs `unsupported syntax` warnings for TRY/CATCH (falls back to `Command` fragments). Suppressed during parse unless `SP_DEBUG_VERBOSE=1`.

Long-term production option: **Microsoft ScriptDom** (.NET) for highest T-SQL fidelity.

---

## VS Code extension

**Name:** MS-SQL SP Debug Script Generator  
**Path:** `vscode-sp-debug/`

### Build & run

```bash
cd vscode-sp-debug
npm install && npm run compile
```

F5 from repo root (`.vscode/launch.json` → Extension Development Host).

**Requires:** workspace root contains `tools/sp-debug/`.

### Commands

| Command | Action |
|---------|--------|
| `spDebug.generate` | Run transform, open debug SQL tab |
| `spDebug.inventory` | Run inventory, open report beside source |

Available from Explorer right-click (`.sql`), editor context menu, and Command Palette.

### Settings

| Key | Default |
|-----|---------|
| `spDebug.pythonPath` | `python3` |
| `spDebug.traceStyle` | `print` |

Output channel: **MS-SQL SP Debug**.

### Package as VSIX

From repo root:

```bash
./scripts/package-vsix.sh
```

Or from `vscode-sp-debug/`:

```bash
npm install && npm run package
```

Output: `vscode-sp-debug/dist/sp-debug.vsix`

```bash
code --install-extension vscode-sp-debug/dist/sp-debug.vsix
cursor --install-extension vscode-sp-debug/dist/sp-debug.vsix
```

Uses `@vscode/vsce@2.32.0` (pinned; v3 has a packaging regression with secret scanning).

Alternative: **Developer: Install Extension from Location…** → `vscode-sp-debug/`.

---

## MVP limitations

Do not rely on output on production without manual review.

| Pattern | Behavior |
|---------|----------|
| Dynamic SQL (`EXEC(@sql)`, `sp_executesql`) | Not analyzed |
| `MERGE` | May preview if line-scanned; not fully tested |
| `INSERT ... EXEC` | Not handled |
| DDL inside proc | Not stubbed |
| Encrypted procs | Cannot read source |
| Cursors | Not rewritten |
| Linked-server / remote hints | Not detected |

**Not a debugger** — no breakpoints, no step-into. Generates a static script only.

---

## Repo layout

```
SQLDebugger/
  README.md                 Overview (this repo)
  TECHNICAL.md              This file
  tools/sp-debug/
    src/sp_debug/           Python package
    samples/                Example procs
    tests/
  vscode-sp-debug/          Extension
  samples/                  User-generated debug outputs
  .vscode/                  Launch config, tasks
```

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `SP_DEBUG_VERBOSE=1` | Show sqlglot parse warnings |
| `NO_COLOR=1` | Disable inventory ANSI colors |
| `PYTHONPATH=tools/sp-debug/src` | Run CLI without pip install (dev) |
