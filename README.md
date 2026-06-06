# SQL SP Harness — VS Code Extension

**Documentation:** [deeprajdeveloper.github.io/vscode-sql-sp-harness](https://deeprajdeveloper.github.io/vscode-sql-sp-harness/) · [Technical design (PDF)](docs/TECHNICAL_DESIGN.pdf)

Run [sql-sp-harness](https://github.com/DeeprajDeveloper/sql-sp-harness) from VS Code to **analyze** T-SQL stored procedures and **generate** safe debug scripts you can execute on a dev database without writing to real tables.

> **Not a live debugger.** This extension generates a static harness script — no breakpoints or step-into debugging on SQL Server.

## Prerequisites

**Python 3.10+** on your PATH (or set `spDebug.pythonPath`).

On first activation the extension checks for the [sql-sp-harness](https://pypi.org/project/sql-sp-harness/) backend. If Python is present but the package is missing, it runs `pip install sql-sp-harness` automatically (disable with `spDebug.autoInstallBackend: false`).

Status appears in the **status bar** (bottom-right) and in the **SQL SP Harness** output channel. Click the status bar item or run **Verify Python Setup** for details.

Manual install (optional):

```bash
pip install sql-sp-harness
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
3. Right-click a `.sql` file → **SQL SP Harness** submenu → **Generate Debug Script** or **Analyze Procedure**

### Commands

| Command | Action |
|---------|--------|
| **Generate Debug Script** | DML → SELECT previews, PRINT traces on variables |
| **Analyze Procedure** | Tabbed analysis panel (Summary, Warnings, Identified) beside the editor |
| **Verify Python Setup** | Check Python + `sql-sp-harness` availability |

Available from the **SQL SP Harness** right-click submenu on `.sql` files (Explorer, editor, and editor tab), and from the Command Palette. Selected text in the editor is used when non-empty.

## Settings

Open **Settings** and search `@ext:DeeprajAdhikary.sql-sp-harness`, or use **Cmd+Shift+P** → **SQL SP Harness: Configure Settings** for an interactive picker. Settings are grouped under **SQL SP Harness**, **SQL SP Harness › Generate**, and **SQL SP Harness › Logging**.

| Setting | Default | Description |
|---------|---------|-------------|
| `spDebug.pythonPath` | *(empty)* | Python executable. Empty = try `python3`, `python`, `py`. |
| `spDebug.pipPackage` | `sql-sp-harness` | PyPI package to install |
| `spDebug.autoInstallBackend` | `true` | Run pip install on activation when backend is missing |
| `spDebug.logToOutput` | `true` | Show step-by-step `--log-file` detail in the Output channel |
| `spDebug.saveLogFile` | `false` | Also write `<proc>.log` beside the source `.sql` file |
| `spDebug.quietWhenLogging` | `true` | Use `--quiet` on generate so logs are not duplicated on stderr |
| `spDebug.traceStyle` | `print` | `print` or `raiserror` for trace lines |

### Step logs in the Output panel

The [sql-sp-harness](https://deeprajdeveloper.github.io/sql-sp-harness/) CLI can write a detailed audit log (`--log` / `--log-file`) for each transform step. With `spDebug.logToOutput` enabled (default), the extension passes `--log-file` and prints that log under **--- Step log ---** in the **SQL SP Harness** output channel after Analyze or Generate.

To also persist the log on disk next to your procedure, set `spDebug.saveLogFile` to `true`.

## Package a VSIX (optional)

```bash
npm run package
code --install-extension dist/sql-sp-harness.vsix
```

## Backend documentation

CLI flags, limitations, and encoding notes: [sql-sp-harness docs](https://deeprajdeveloper.github.io/sql-sp-harness/)

## Project documentation

| Resource | Location |
|----------|----------|
| User guide (GitHub Pages) | [docs/index.html](docs/index.html) → `npm run docs:serve` |
| Technical design (Markdown) | [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md) |
| Technical design (PDF) | `npm run docs:pdf` → [docs/TECHNICAL_DESIGN.pdf](docs/TECHNICAL_DESIGN.pdf) |

Build docs locally:

```bash
npm run docs:build   # compile CSS
npm run docs:pdf     # also generate PDF
npm run docs:serve   # preview at http://localhost:8080
```

Enable GitHub Pages: repo **Settings → Pages → Deploy from branch → main → /docs**.

## License

MIT — see [LICENSE](LICENSE).
