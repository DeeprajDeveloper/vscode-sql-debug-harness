# SQL Debug Harness — MVP 1 Requirements Document

**Repo:** `vscode-sql-debug-harness` (extension)
**Status:** **Originally shipped as `0.0.1-beta.1`; current release `0.0.4`.** The TypeScript engine runs in-process inside the extension (and optional `npx` CLI). Python/PyPI backend path is retired. This document remains the MVP1 scope of record.

---

## 1. Problem Statement

Engineers frequently need to review or test T-SQL stored procedures without risking writes to a real database — especially against production or shared dev environments. Today this requires either manually commenting out DML, wrapping everything in a transaction and hoping to remember the `ROLLBACK`, or just not testing locally at all.

**SQL Debug Harness** solves this by statically analyzing a T-SQL stored procedure and generating a "debug script" — a rewritten version where DML statements (`INSERT`/`UPDATE`/`DELETE`) are converted into read-only previews (`SELECT`) and key variables are traced via `PRINT`/`RAISERROR`, so the script can be run safely without committing any real change.

## 2. Goals for MVP1

1. Ship a **reliable, well-documented v1.0** that does one thing very well: T-SQL stored procedure → safe debug script.
2. Make the tool **trustworthy** — it must never silently produce a script that looks safe but isn't (e.g. missing a DML statement, mishandling a nested transaction).
3. **Zero external runtime dependencies.** Installing the extension from the Marketplace should be the entire setup — no Python, no separate package manager, no PATH detection, no auto-install step.
4. Make it **installable and usable in under 5 minutes** by someone who has never seen the project before (Marketplace install → run on a sample proc → see output).
5. Produce something **demo-able** for a portfolio: a clean before/after example, a short GIF/video, and a README that sells the "why."

## 3. Non-Goals for MVP1 (explicitly out of scope)

Being explicit here matters as much as the in-scope list — both for your own focus and for setting correct expectations with anyone who finds the repo.

- ❌ **Multi-dialect support.** T-SQL only for MVP1. PL/pgSQL, PL/SQL, MySQL are post-MVP.
- ❌ **Live/step-through debugging** (breakpoints, step-into). The README already correctly disclaims this — keep it that way. This is a *static rewrite* tool, not a debugger.
- ❌ **Dynamic SQL** (`EXEC(@sql)`, `sp_executesql` with fully dynamic strings). Detect and flag as unsupported rather than attempting a rewrite.
- ❌ **Arbitrary ad-hoc scripts.** MVP1 targets stored procedures specifically (per current scope), not any `.sql` file with mixed DDL/DML/control flow.
- ❌ **Actual live DB connection / transaction-wrapper execution mode.** MVP1 stays fully static (no DB connection required to generate the script). A "connect and run inside `BEGIN...ROLLBACK`" mode is a strong v2 idea but adds connection management, credential handling, and DB-specific rollback edge cases — don't take that on yet.
- ❌ **Cursors, loops (`WHILE`), and complex control flow rewriting.** Detect and warn if present; don't guarantee correct rewriting inside them for MVP1.
- ❌ **Auto-fix suggestions or linting beyond DML detection.** Analysis panel shows warnings; it doesn't try to "fix" the procedure.
- ❌ **Retaining the Python backend as a parallel/optional path.** MVP1 fully replaces it — no dual-maintenance of two engines. (See §5.0 for rationale.)

## 4. Target User & Core User Story

**Primary persona:** A backend/data engineer who has a T-SQL stored procedure they didn't write (or haven't touched in a while) and wants to understand what it *would* do before running it for real.

**Core user story:**
> As a developer, I right-click a `.sql` file containing a stored procedure, choose "Generate Debug Script," and get a new script where every DML statement is replaced with an equivalent `SELECT` showing what rows/values would be affected — so I can run it against a real (even production-adjacent) connection with zero risk of data mutation.

## 5. Architecture Decision: Node/TypeScript Backend (replaces Python)

### 5.0 Rationale
The original design (VSCode extension → shells out to a Python CLI, `pip install`-ed on first run) creates real adoption friction: users need Python on PATH, first-run auto-install can fail silently (locked-down corporate machines, permission issues, wrong Python version picked up), and it doubles the languages/runtimes you maintain. VSCode extensions run on Node.js already, so a Node-native backend removes an entire dependency and an entire class of first-run failures.

### 5.1 Parsing library
Use **`node-sql-parser`**, which ships a dedicated TransactSQL build:
```ts
import { Parser } from 'node-sql-parser/build/transactsql';
const parser = new Parser();
const ast = parser.astify(sqlText);
```
In practice the engine uses a **hybrid** approach: optional AST plus authoritative text-scan transforms, because full AST parsing often fails on enterprise T-SQL.

### 5.2 Module boundaries (as shipped)

| Path | Role |
|------|------|
| `src/engine/parser.ts` | Best-effort `node-sql-parser` wrapper |
| `src/engine/transform.ts` | DML → SELECT, TCL neutralize, traces, EXEC stubs |
| `src/engine/inventory.ts` | Analyze Summary / Warnings / Identified |
| `src/engine/unsupported.ts` | Dynamic SQL, cursors, `WHILE`, `MERGE`, `OUTPUT` |
| `src/cli.ts` | `npx sql-debug-harness generate\|analyze\|version` |

### 5.3 Migration outcome
- Fixtures under `/samples` are the Jest regression suite (`src/engine/__tests__/`).
- Python backend and related settings (`pythonPath`, `pipPackage`, `autoInstallBackend`, `verifySetup`) are removed.
- Text scan remains authoritative when AST fails.

## 6. Functional Requirements (MVP1 scope)

### 6.1 Core transform (in-extension TS module)
- FR1: Parse / prepare a T-SQL `CREATE PROCEDURE` / `ALTER PROCEDURE` script (hybrid AST + text scan).
- FR2: Detect all `INSERT`, `UPDATE`, `DELETE` statements and rewrite each into a `SELECT` that previews affected rows/values.
- FR3: Detect all TCL statements (`BEGIN TRAN`, `COMMIT`, `ROLLBACK`, `SAVE TRAN`) and neutralize them so they cannot commit a real change, while preserving script structure.
- FR4: Insert variable traces at meaningful points (configurable via `spDebug.traceStyle`: `select`, `print`, `printCombined`, or `raiserror`).
- FR5: Detect statements the tool **cannot safely rewrite** (dynamic SQL, cursors, complex nested control flow) and surface them as explicit warnings rather than silently passing them through unchanged.
- FR6: Optional Node CLI (`npx sql-debug-harness generate|analyze`) sharing the same TS module as the extension. **Done.**

### 6.2 Extension UX
- FR7: Command **"Generate Debug Script"** — runs on active file or selection, outputs the rewritten script in the Workbench.
- FR8: Command **"Analyze Procedure"** — shows Summary / Warnings / Identified in the Workbench.
- FR9: ~~"Verify Python Setup" command~~ — **removed.** No backend runtime check needed; the transform runs in-process with the extension.
- FR10: **Warnings must be visually distinct and impossible to miss** — if FR5 flags something the tool couldn't safely handle, that needs to be prominent in the Analyze panel output, not buried in a log.
- FR11: Right-click context menu integration on `.sql` files (existing).
- FR12: Settings UI — drop `spDebug.pythonPath`, `spDebug.pipPackage`, and `spDebug.autoInstallBackend` entirely. Retain logging (`spDebug.logToOutput`, `spDebug.saveLogFile`) and `spDebug.traceStyle`, now backed by the TS module directly. **Done.**

### 6.3 Documentation & onboarding
- FR13: README leads with a **before/after example** (input proc → generated debug script) directly in the markdown, not just a link out. **Done.**
- FR14: A **"Limitations" section** in the README that mirrors §3 of this doc — dynamic SQL, cursors, dialect scope, no live-connection mode. **Done.**
- FR15: A short (30–60s) demo GIF showing the actual right-click → generate → diff view flow. *(still open for v1.0 polish)*
- FR16: Quickstart that gets a new user from "install" to "see output on a sample proc" in under 5 minutes, using a proc from `/samples`. **Done.**
- FR17: A short **"Why no Python backend?"** architecture note in the README/technical design doc. **Done.**

## 7. Non-Functional Requirements

- NFR1: **Correctness over coverage.** It's better to flag a statement as "unsupported, not rewritten" than to produce an incorrect rewrite that looks safe. This is the single most important quality bar for a tool whose entire value proposition is safety.
- NFR2: Fully self-contained — zero external runtime or interpreter dependency beyond what VSCode's Node.js environment already provides.
- NFR3: Extension activation and analysis on a typical (<200 line) stored procedure should complete in under 2 seconds — comfortably achievable with an in-process engine.
- NFR4: Clear, specific error messages on **parse failure** (malformed SQL, unsupported syntax).
- NFR5: MIT license retained; no telemetry without explicit opt-in.

## 8. Test Coverage Required Before Calling This MVP1-Complete

Regression suite status against `samples/fixtures/` + Jest (`src/engine/__tests__/engine.test.ts`):

- [x] Simple `INSERT`/`UPDATE`/`DELETE` → correct `SELECT` rewrite
- [x] `UPDATE ... FROM ... JOIN` (multi-table update) rewrite
- [x] Statement using `OUTPUT` clause (warned)
- [x] Nested transactions / mid-script `COMMIT`/`ROLLBACK` (TCL neutralized)
- [x] `TRY...CATCH` blocks wrapping DML
- [x] Temp tables and table variables (both left alone — no durable-table side effects)
- [x] CTEs and `MERGE` statements (`MERGE` flagged + disabled)
- [x] Dynamic SQL present → flagged, not silently mishandled
- [x] Cursor present → flagged
- [x] Proc with no DML at all (pure `SELECT` proc) → clean pass-through
- [x] Malformed/unparseable input → graceful error, not a crash

## 9. Success Criteria for MVP1 / v1.0 Release

- [ ] Published on the VS Code Marketplace (not just GitHub).
- [x] Zero mentions of Python/pip required for end users — install is "add the extension," full stop.
- [x] README includes before/after example, limitations section, and the architecture note (FR17). Demo GIF still open (FR15).
- [x] All test cases in §8 pass or are explicitly documented as known limitations.
- [x] A stranger can install from VSIX and get correct output on a sample proc without contacting you, on a machine with nothing pre-installed but VS Code / Node.
- [x] Python backend/PyPI path retired in favor of the extension-native TypeScript engine.

## 10. Resolved open questions

- **Port vs redesign:** hybrid text-scan + optional AST; text scan is authoritative.
- **`node-sql-parser` gaps:** accepted; unsupported constructs are warned.
- **Standalone CLI:** included for MVP1 (`npx sql-debug-harness`).
- **Dialect identity:** T-SQL for v1; multi-dialect noted as a v2 roadmap item in the README.

## 11. Milestone outcome

1. ~~Spike the parser.~~ Hybrid design chosen.
2. ~~Port the core transform to TS.~~ Shipped in `src/engine/`.
3. ~~Harden test coverage~~ — §8 fixtures covered by Jest.
4. ~~Wire into the extension~~ — Python settings/commands removed.
5. ~~Tighten warnings/UX~~ — Workbench Analysis › Warnings + step log.
6. ~~Documentation pass~~ — README, docs site, technical design aligned to TS engine.
7. **Package and publish** — Marketplace listing still pending; VSIX via `npm run package`.
8. **Portfolio writeup** — optional follow-up.
