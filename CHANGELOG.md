# Change Log

All notable changes to SQL Debug Harness are documented here.

## 0.0.4 — 2026-08-01

### Changed

- `INSERT` / `UPDATE` / `DELETE` against temporary tables (`#temp`, `##temp`) are left live in the harness (same as table-variable DML), since they do not write to durable user tables.
- When a `SET` or `SELECT @var = …` sits under a bare `IF` / `ELSE` / `WHILE` (no `BEGIN`/`END`), the assignment and its variable trace are wrapped in `BEGIN`…`END` so the branch stays valid.

### Fixed

- Variable traces after bare `IF`/`ELSE` single-statement bodies no longer break `IF`/`ELSE` pairing or run outside the intended branch.

## 0.0.3 — 2026-07-27

### Added

- `spDebug.traceStyle` values `select` (new default) and `printCombined` for variable traces.
- Workbench **Clear** action to wipe generated debug script, analysis, and activity log while keeping the loaded source.
- Workbench **Save** popover menu that groups Analysis Report, Debug Script, Log File, and Open Debug Script.

### Changed

- Variable traces default to `SELECT 'DBG' [NOTES], @var [var], …` instead of one `PRINT` per variable.
- `print` still emits one `PRINT` per variable; `printCombined` folds multi-variable assignments into a single `PRINT CONCAT`.
- Procedure `AS BEGIN` / outer procedure `END` wrappers are stripped from generated harness scripts.
- Inline first-line procedure parameters continue onto following lines until `AS`, preserving one continuous `DECLARE` list.

### Fixed

- Parameters after an inline first-line `@param` no longer remain as orphaned type lines outside `DECLARE`.
- Nested `BEGIN` / `END` blocks inside the procedure body are preserved when the outer procedure wrapper is removed.

## 0.0.2 — 2026-07-25

### Added

- Workspace-scoped history for recently analyzed and debugged stored procedures.
- Workbench History picker for reopening recent procedures.
- Grouped, collapsible Identified results by Kind.
- Distinct SVG icons for every Workbench toolbar action.
- `spDebug.workbenchToolbarStyle` with `iconsAndText`, `iconsOnly`, and `textOnly` modes.
- Dedicated documentation change-history page.

### Changed

- Procedure parameters now generate one comma-separated `DECLARE` statement.
- Parenthesized procedure parameter lists are supported.
- Procedure `OUTPUT`, `OUT`, and `READONLY` modifiers are removed from generated declarations; output parameters are annotated.
- The Workbench opens as a normal tab in the active editor group.
- Analysis and Activity Log collapse by clicking the full header and remain in document order.
- Source, generated SQL, and log panes preserve long lines and scroll horizontally.
- Workbench toolbar icons use a consistent stroke-based SVG style.

### Fixed

- Prevented semicolons from being inserted between generated parameter declarations.
- Prevented `OUTPUT` / `OUT` tokens from producing invalid `DECLARE` syntax.
- Fixed parenthesized parameter headers being treated as procedures with no parameters.
- Fixed Identified accordions rendering horizontally.
- Fixed Activity Log moving above Analysis when Analysis was collapsed.
- Fixed unavailable horizontal scrolling for long SQL lines.
- Fixed the Workbench History button opening the activity-bar sidebar.

## 0.0.1 — 2026-07-19

### Added

- Initial VS Code extension and optional CLI.
- In-process TypeScript transformation engine.
- Static T-SQL analysis with Summary, Warnings, and Identified results.
- Read-only previews for `INSERT`, `UPDATE`, and `DELETE`.
- Transaction-control neutralization.
- Named `EXEC` stubs and variable tracing.
- Workbench with source, generated SQL, analysis, and activity-log panes.
- VSIX packaging and GitHub Pages documentation.
