# MS-SQL Debug Script Transformer

Generate **safe debug harness scripts** and **structural inventory reports** from T-SQL stored procedures — without writing to real tables.

> **Not a live debugger.** This extension does not attach breakpoints or step through procedures on SQL Server. It generates a static script you run in SSMS or the MSSQL extension on a **dev** database.

## Features

### Generate Transformed Debug Script

- **DML previews** — `INSERT` / `UPDATE` / `DELETE` on real tables become `SELECT` previews with `[DBG_Action]` and projected values
- **Variable traces** — `PRINT` after `SET @var` / `SELECT @var =` to follow execution in Messages
- **Safety banner** — `DEBUG HARNESS — DO NOT RUN ON PRODUCTION`
- **Table variables preserved** — `@table` DML is left unchanged

### Structural Keyword Report (inventory)

Summary counts, warnings, and line-level detail for DML, TRY/CATCH, loops, SET statements, and more.

### Where to run

| Location | Actions |
|----------|---------|
| Explorer — right-click `.sql` | Generate · Inventory |
| Editor — right-click in SQL tab | Same |
| Command Palette | `MS-SQL Debug Scripter` |

Selected text in the editor is used when non-empty; Explorer always uses the full file.

---

## Prerequisites

1. **Python 3.10+**
2. Install the backend package (PyPI name: **mssql-sp-debug**):

   ```bash
   pip install mssql-sp-debug
   ```

3. Verify:

   ```bash
   python3 -m sp_debug version
   ```

4. In VS Code / Cursor: run **MS-SQL Debug Scripter: Verify Python Setup** (Command Palette).

### Monorepo developers

If you open the [SQLDebugger](https://github.com/DeeprajDeveloper/mssql-sp-debug-scripter) repo, the extension can use `tools/sp-debug` from the workspace when pip install is missing (`spDebug.preferWorkspaceDev`, default on).

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `spDebug.pythonPath` | *(empty)* | Python executable. Empty = try `python3`, `python`, `py`. |
| `spDebug.pipPackage` | `mssql-sp-debug` | Package name in install hints |
| `spDebug.preferWorkspaceDev` | `true` | Use `tools/sp-debug` in workspace when present |
| `spDebug.traceStyle` | `print` | `print` or `raiserror` for trace lines |

Example `settings.json`:

```json
{
  "spDebug.pythonPath": "C:\\Python312\\python.exe",
  "spDebug.traceStyle": "print"
}
```

---

## Install the extension

### From VSIX (local)

```bash
git clone https://github.com/DeeprajDeveloper/mssql-sp-debug-scripter.git
cd mssql-sp-debug-scripter
./scripts/package-vsix.sh
code --install-extension vscode-sp-debug/dist/sp-debug.vsix
```

### From Marketplace

*(after publish)* search **MS-SQL Debug Script Transformer** in Extensions.

---

## Limitations

Review generated scripts before running on any shared server.

| Pattern | Behavior |
|---------|----------|
| Dynamic SQL (`EXEC(@sql)`, `sp_executesql`) | Not analyzed |
| `MERGE` | Partial / line-scan only |
| `INSERT ... EXEC` | Not handled |
| DDL inside proc | Not stubbed |
| Encrypted procedures | No source |
| Cursors | Not rewritten |

Full technical notes: [project TECHNICAL.md](https://github.com/DeeprajDeveloper/mssql-sp-debug-scripter/blob/main/TECHNICAL.md)

---

## CLI (same backend)

```bash
pip install mssql-sp-debug
sp-debug transform -i MyProc.sql -o MyProc_debug.sql
sp-debug inventory -i MyProc.sql
```

---

## License

MIT — see [LICENSE](LICENSE).
