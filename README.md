# SQL SP Harness — VS Code Extension

Run [sql-sp-harness](https://github.com/DeeprajDeveloper/sql-sp-harness) from VS Code to **analyze** T-SQL stored procedures and **generate** safe debug scripts you can execute on a dev database without writing to real tables.

> **Not a live debugger.** This extension generates a static harness script — no breakpoints or step-into debugging on SQL Server.

## Prerequisites

1. **Python 3.10+**
2. Install the backend from PyPI:

   ```bash
   pip install sql-sp-harness
   ```

3. Verify:

   ```bash
   python3 -m sql_sp_harness version
   ```

## Local development

```bash
git clone https://github.com/DeeprajDeveloper/vscode-sql-sp-harness.git
cd vscode-sql-sp-harness
pip install sql-sp-harness
npm install
npm run compile
```

Press **F5** in VS Code / Cursor to launch an **Extension Development Host**.

In the new window:

1. Open any folder with a `.sql` file
2. Run **SQL SP Harness: Verify Python Setup** from the Command Palette
3. Right-click a `.sql` file → **Generate Debug Script** or **Analyze Procedure**

### Commands

| Command | Action |
|---------|--------|
| **Generate Debug Script** | DML → SELECT previews, PRINT traces on variables |
| **Analyze Procedure** | Tabbed analysis panel (Summary, Warnings, Identified) beside the editor |
| **Verify Python Setup** | Check Python + `sql-sp-harness` availability |

Available from Explorer right-click (`.sql`), editor context menu, and Command Palette. Selected text in the editor is used when non-empty.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `spDebug.pythonPath` | *(empty)* | Python executable. Empty = try `python3`, `python`, `py`. |
| `spDebug.pipPackage` | `sql-sp-harness` | Package name in install hints |
| `spDebug.traceStyle` | `print` | `print` or `raiserror` for trace lines |

## Package a VSIX (optional)

```bash
npm run package
code --install-extension dist/sql-sp-harness.vsix
```

## Backend documentation

CLI flags, limitations, and encoding notes: [sql-sp-harness docs](https://deeprajdeveloper.github.io/sql-sp-harness/)

## License

MIT — see [LICENSE](LICENSE).
