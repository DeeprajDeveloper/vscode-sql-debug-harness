# MS-SQL SP Debug Script Generator (extension)

VS Code / Cursor extension for the [project](../README.md). Technical details: [TECHNICAL.md](../TECHNICAL.md).

Wraps the Python [**sp-debug**](../tools/sp-debug/) CLI to analyze and transform T-SQL stored procedures into **safe, runnable debug scripts**.

## Features

### Generate Debug Script

Turns a stored procedure into a debug harness you can run in SSMS or the MSSQL extension:

- **DML previews** — `INSERT` / `UPDATE` / `DELETE` against real tables become `SELECT` previews with a `[DBG_Action]` column plus the values that would be written
- **Variable traces** — `PRINT` lines after each `SET @var` (and `SELECT @var =`) so you can follow execution in the Messages tab
- **Safety banner** — output includes `DEBUG HARNESS — DO NOT RUN ON PRODUCTION`
- **Table variables preserved** — `INSERT INTO @t` / `UPDATE @t` are left unchanged

### Run Inventory Report

Structural analysis of a `.sql` file before you transform it:

- **Summary table** — counts for DML, TRY/CATCH, IF/WHILE, SET, Command fragments, etc.
- **Warnings & errors** — parser and scan warnings in one place
- **Identified section** — lists each detected statement with line numbers and detail

### Where to run commands

| Location | Actions |
|----------|---------|
| **Explorer** — right-click a `.sql` file | Generate Debug Script · Run Inventory Report |
| **Editor** — right-click in a `.sql` tab | Same commands |
| **Command Palette** (`Cmd+Shift+P`) | Search `MS-SQL SP Debug` |

If text is **selected** in the editor, only the selection is used. From the Explorer, the **full file** is always used.

---

## Prerequisites

1. **Python 3.10+** with `sp-debug` installed:

   ```bash
   cd tools/sp-debug
   pip install -e .
   ```

2. Open the **SQLDebugger** workspace root (the folder that contains `tools/sp-debug`).

3. Verify the CLI:

   ```bash
   python3 -m sp_debug transform -i tools/sp-debug/samples/my_proc.sql --quiet
   python3 -m sp_debug inventory -i tools/sp-debug/samples/my_proc.sql
   ```

---

## Install & run locally

### Development (F5)

```bash
cd vscode-sp-debug
npm install
npm run compile
```

1. Open the **SQLDebugger** repo root in Cursor/VS Code
2. Run **SP Debug: Run VSCode Extension** from the Run and Debug panel (or F5)
3. In the Extension Development Host window, open a `.sql` file and use the commands above

### Install into your editor

```bash
cd vscode-sp-debug
npm run compile
```

Then: **Command Palette → Developer: Install Extension from Location…** → select `vscode-sp-debug`, and reload.

Or package a VSIX from the repo root:

```bash
./scripts/package-vsix.sh
code --install-extension vscode-sp-debug/dist/sp-debug.vsix
```

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `spDebug.pythonPath` | `python3` | Python executable with `sp-debug` installed |
| `spDebug.traceStyle` | `print` | `print` (Messages tab) or `raiserror` (WITH NOWAIT) |

Example:

```json
{
  "spDebug.pythonPath": "/usr/local/bin/python3",
  "spDebug.traceStyle": "print"
}
```

---

## Output

- **Debug script** — opens in a new SQL editor tab (save as `*_debug.sql`)
- **Inventory** — opens beside your source file; full log also in **MS-SQL SP Debug** output channel (**View → Output**)

---

## Limitations

See [tools/sp-debug/README.md](../tools/sp-debug/README.md) for MVP exclusions (dynamic SQL, MERGE edge cases, encrypted procs, etc.). Always review generated scripts before running against a shared cluster.

---

## Project layout

```
SQLDebugger/
  tools/sp-debug/       # Python CLI (transform + inventory)
  vscode-sp-debug/      # This extension
```
