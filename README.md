# MS-SQL SP Debug Script Generator

Debug Microsoft SQL Server stored procedures **without changing data** on real tables.

This project turns a T-SQL stored procedure into a **safe debug script** you can run in SSMS or the VS Code MSSQL extension. It also provides an **inventory report** that summarizes what’s inside a procedure before you transform it.

## The problem

Step debugging inside live stored procedures on enterprise SQL Server is often unavailable (no SSDT attach, no VS breakpoints on the cluster). The usual workaround is manual: comment out `INSERT`/`UPDATE`/`DELETE`, add `PRINT` for variables, run the proc, read Messages and result sets. That’s slow and easy to get wrong.

## What this does

| Feature | What you get |
|---------|----------------|
| **Generate debug script** | A copy of your proc with DML replaced by `SELECT` previews and `PRINT` traces after variable assignments |
| **Inventory report** | A summary of DML, TRY/CATCH, loops, SET statements, and more — with line-level detail |

You run the generated script on a **dev** database, watch variable values in **Messages**, and inspect **would-be** DML changes in **Results** — without writing to production tables.

## Quick start

**1. Install the Python tool**

```bash
pip install mssql-sp-debug
# or from this repo:
cd tools/sp-debug && pip install -e ".[dev]"
```

**2. Generate a debug script**

```bash
python3 -m sp_debug transform -i tools/sp-debug/samples/my_proc.sql -o my_proc_debug.sql
```

**3. Or use the VS Code / Cursor extension**

```bash
cd vscode-sp-debug && npm install && npm run compile
```

Install `mssql-sp-debug` (see above), open any folder with `.sql` files, install the extension (VSIX or Marketplace), then **Verify Python Setup** and **Generate Transformed Debug Script** from the Command Palette or right-click on `.sql`.

## Project structure

```
SQLDebugger/
  tools/sp-debug/      Python CLI (transform + inventory)
  vscode-sp-debug/     Editor extension
  samples/             Example procedures and outputs
```

## Install the extension (VSIX)

```bash
./scripts/package-vsix.sh
code --install-extension vscode-sp-debug/dist/sp-debug.vsix
```

Re-run `./scripts/package-vsix.sh` after any extension changes.

## Documentation

- **[TECHNICAL.md](TECHNICAL.md)** — architecture, CLI flags, extension setup, parser details, limitations
- [tools/sp-debug/README.md](tools/sp-debug/README.md) — CLI reference
- [vscode-sp-debug/README.md](vscode-sp-debug/README.md) — extension install and usage

## Important

Generated scripts include a **DO NOT RUN ON PRODUCTION** banner. Always review output before running on a shared server. This tool does **not** provide live breakpoints or step-into debugging — it generates a static harness script.
