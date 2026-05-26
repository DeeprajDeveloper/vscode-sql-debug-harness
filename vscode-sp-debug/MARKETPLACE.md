# Marketplace publish checklist

Use this before publishing **MS-SQL Debug Script Transformer** to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/).

## 1. Python package on PyPI

The extension shells out to `python -m sp_debug`. Users install:

```bash
pip install mssql-sp-debug
```

From repo root:

```bash
cd tools/sp-debug && pip install -e .
pytest
./scripts/publish-pypi.sh
./scripts/publish-pypi.sh upload   # when ready
```

Verify:

```bash
python3 -m sp_debug version
```

## 2. Extension VSIX

```bash
./scripts/package-vsix.sh
```

Smoke-test in a **fresh** VS Code window (not this monorepo):

1. Install `vscode-sp-debug/dist/sp-debug.vsix`
2. Open any folder with a `.sql` file
3. Run **MS-SQL Debug Scripter: Verify Python Setup**
4. Run **Generate Transformed Debug Script** on a sample proc

## 3. Marketplace listing

- **Publisher:** `DeeprajAdhikary` (create at [marketplace.visualstudio.com](https://marketplace.visualstudio.com/manage))
- **Personal Access Token** with Marketplace *Manage* scope
- `vsce login DeeprajAdhikary`
- `cd vscode-sp-debug && npx vsce publish`

### README requirements

`vscode-sp-debug/README.md` is the listing page. It must:

- State **not a live debugger** (script generator only)
- List **Python 3.10+** and `pip install mssql-sp-debug`
- Include screenshots (add under `images/`)
- Document limitations (dynamic SQL, encrypted procs, etc.)

### package.json

- `repository.url` points to GitHub
- `license` MIT
- `icon` present
- Categories: avoid misleading “debugger” if reviews complain — current includes SQL Debugging

## 4. Support expectations

- Issues on GitHub
- Version bumps: align `package.json`, `sp_debug.__version__`, and `pyproject.toml`

## 5. Optional next steps

- CI: GitHub Action for `pytest` + `npm run compile` + `vsce package`
- Bundle Python (heavy) for users without pip
- `sp-debug` console script alias documented alongside `python -m sp_debug`
