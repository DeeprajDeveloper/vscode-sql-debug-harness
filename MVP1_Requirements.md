# SQL SP Harness — MVP 1 Requirements Document

**Repo:** `vscode-sql-sp-harness` (extension)
**Status:** Extension scaffolding and rewrite logic already exist as a Python backend (`sql-sp-harness` on PyPI). This document scopes MVP1 as a **port of the backend into TypeScript, running natively inside the extension**, plus the hardening/documentation work needed to call this a trustworthy v1.0.

---

## 1. Problem Statement

Engineers frequently need to review or test T-SQL stored procedures without risking writes to a real database — especially against production or shared dev environments. Today this requires either manually commenting out DML, wrapping everything in a transaction and hoping to remember the `ROLLBACK`, or just not testing locally at all.

**SQL SP Harness** solves this by statically analyzing a T-SQL stored procedure and generating a "debug script" — a rewritten version where DML statements (`INSERT`/`UPDATE`/`DELETE`) are converted into read-only previews (`SELECT`) and key variables are traced via `PRINT`/`RAISERROR`, so the script can be run safely without committing any real change.

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
This replaces whatever T-SQL parsing the Python backend was doing (`sqlparse`/`sqlglot`/custom regex, depending on what was actually used).

### 5.2 Module boundaries
Structure the ported logic as a standalone, testable module inside the extension repo (or a sibling npm package if you want it independently publishable/reusable later — e.g. as an `npx`-runnable CLI):

- `parser/` — wraps `node-sql-parser`, handles parse errors gracefully
- `rewrite/` — the core transform: DML → SELECT preview, TCL neutralization, variable trace injection
- `analyze/` — produces the Summary/Warnings/Identified data consumed by the Analyze panel
- `unsupported/` — detection rules for dynamic SQL, cursors, complex control flow (feeds warnings, not silent pass-through)
- `cli/` (optional) — thin wrapper exposing `generate`/`analyze` as an `npx`-runnable command, if you want to preserve a standalone CLI story without Python

### 5.3 Migration approach
- Port rule-by-rule against the existing `/samples` fixtures — these become the regression suite that proves parity with the Python version before it's retired.
- Do **not** run both engines in parallel long-term. Once TS output matches on the fixture set, cut over fully and delete the Python backend + PyPI package references (or archive the PyPI package with a note pointing to the new version).
- If `node-sql-parser`'s TransactSQL grammar can't cleanly handle something the Python version did (temp tables, table variables, `MERGE`, CTEs, `OUTPUT` clauses are the likely trouble spots), that's a real risk to surface early — spike this against a few real-world procs before committing to full port.

## 6. Functional Requirements (MVP1 scope)

### 6.1 Core transform (in-extension TS module)
- FR1: Parse a single T-SQL `CREATE PROCEDURE` / `ALTER PROCEDURE` script using `node-sql-parser` (transactsql build).
- FR2: Detect all `INSERT`, `UPDATE`, `DELETE` statements and rewrite each into a `SELECT` that previews affected rows/values.
- FR3: Detect all TCL statements (`BEGIN TRAN`, `COMMIT`, `ROLLBACK`, `SAVE TRAN`) and neutralize them so they cannot commit a real change, while preserving script structure.
- FR4: Insert `PRINT` or `RAISERROR` trace statements for declared variables at meaningful points (configurable, matching existing `spDebug.traceStyle`).
- FR5: Detect statements the tool **cannot safely rewrite** (dynamic SQL, cursors, complex nested control flow, and any T-SQL construct `node-sql-parser` fails to parse) and surface them as explicit warnings rather than silently passing them through unchanged.
- FR6: Provide an optional Node CLI (`npx sql-sp-harness generate|analyze`) if you want a standalone-usable tool outside VSCode, sharing the same TS module as the extension.

### 6.2 Extension UX
- FR7: Command **"Generate Debug Script"** — runs on active file or selection, outputs the rewritten script (existing).
- FR8: Command **"Analyze Procedure"** — shows a tabbed panel (Summary / Warnings / Identified statements) beside the editor (existing).
- FR9: ~~"Verify Python Setup" command~~ — **removed.** No backend runtime check needed; the transform runs in-process with the extension.
- FR10: **Warnings must be visually distinct and impossible to miss** — if FR5 flags something the tool couldn't safely handle, that needs to be prominent in the Analyze panel output, not buried in a log.
- FR11: Right-click context menu integration on `.sql` files (existing).
- FR12: Settings UI — drop `spDebug.pythonPath`, `spDebug.pipPackage`, and `spDebug.autoInstallBackend` entirely. Retain logging (`spDebug.logToOutput`, `spDebug.saveLogFile`) and `spDebug.traceStyle`, now backed by the TS module directly.

### 6.3 Documentation & onboarding
- FR13: README leads with a **before/after example** (input proc → generated debug script) directly in the markdown, not just a link out.
- FR14: A **"Limitations" section** in the README that mirrors §3 of this doc — dynamic SQL, cursors, dialect scope, no live-connection mode. This is what makes the tool trustworthy rather than overselling.
- FR15: A short (30–60s) demo GIF showing the actual right-click → generate → diff view flow.
- FR16: Quickstart that gets a new user from "install" to "see output on a sample proc" in under 5 minutes, using a proc from `/samples` — now genuinely just "install extension," since there's no backend setup step left to document.
- FR17: A short **"Why no Python backend?"** or architecture note in the README/technical design doc — this is a good engineering-judgment story to tell explicitly on a portfolio (you identified a real adoption blocker and fixed it), don't bury it.

## 7. Non-Functional Requirements

- NFR1: **Correctness over coverage.** It's better to flag a statement as "unsupported, not rewritten" than to produce an incorrect rewrite that looks safe. This is the single most important quality bar for a tool whose entire value proposition is safety.
- NFR2: Fully self-contained — zero external runtime or interpreter dependency beyond what VSCode's Node.js environment already provides.
- NFR3: Extension activation and analysis on a typical (<200 line) stored procedure should complete in under 2 seconds — should be comfortably achievable now that there's no subprocess/IPC overhead to a separate Python process.
- NFR4: Clear, specific error messages on **parse failure** (malformed SQL, unsupported syntax) — this replaces the old "Python/backend setup failed" error class as the main first-run failure mode to design for.
- NFR5: MIT license retained; no telemetry without explicit opt-in.

## 8. Test Coverage Required Before Calling This MVP1-Complete

This is the gap most likely to exist in a project at this stage, and the part that actually earns trust from anyone evaluating the repo. With the backend port, this list doubles as your **parity regression suite** against the old Python output:

- [ ] Simple `INSERT`/`UPDATE`/`DELETE` → correct `SELECT` rewrite
- [ ] `UPDATE ... FROM ... JOIN` (multi-table update) rewrite
- [ ] Statement using `OUTPUT` clause
- [ ] Nested transactions (`BEGIN TRAN` inside a proc that's already in one)
- [ ] Explicit mid-script `COMMIT`/`ROLLBACK`
- [ ] `TRY...CATCH` blocks wrapping DML
- [ ] Temp tables and table variables (flagged as a likely `node-sql-parser` edge case — verify explicitly)
- [ ] CTEs and `MERGE` statements (same — verify explicitly, these are common T-SQL parser pain points)
- [ ] Dynamic SQL present → confirm it's flagged, not silently mishandled
- [ ] Cursor present → confirm it's flagged
- [ ] Proc with no DML at all (pure `SELECT` proc) → confirm clean pass-through
- [ ] Malformed/unparseable input → graceful error, not a crash

Each of these should become an entry in `/samples` with an expected-output fixture, and an automated test suite (Jest or similar) in the extension repo itself now that everything lives in one TS codebase.

## 9. Success Criteria for MVP1 / v1.0 Release

- Published on the VS Code Marketplace (not just GitHub).
- Zero mentions of Python/pip required for end users — install is "add the extension," full stop.
- README includes before/after example, limitations section, demo GIF, and the architecture note (FR17).
- All test cases in §8 pass or are explicitly documented as known limitations.
- A stranger can install it and get correct output on a sample proc without contacting you, on a machine with nothing pre-installed but VS Code.
- Python backend/PyPI package is either fully retired or clearly marked deprecated in favor of the extension-native version.

## 10. Open Questions to Resolve Before Building

- Does the current Python backend logic live somewhere you can port rule-by-rule (readable transform rules), or does it lean heavily on a Python-specific parsing library in ways that need to be redesigned rather than translated? Worth a quick audit before estimating the port.
- Spike `node-sql-parser`'s TransactSQL support against a handful of real, moderately complex stored procs (temp tables, CTEs, `MERGE`) early — if it has major gaps, better to know before the port is half-done than after.
- Do you want the standalone CLI (FR6) at all for MVP1, or is "VSCode extension only" the right scope to ship faster? Either is defensible; just pick one deliberately.
- Is SQL Server (T-SQL) alone the permanent identity of this tool, or is dialect-expansion the planned v2 headline feature? `node-sql-parser` supporting multiple dialects (MySQL, PostgreSQL, etc.) actually makes multi-dialect a more realistic v2 than it would've been with a custom Python parser — worth a one-line "Roadmap" mention in the README now.

## 11. Suggested Milestone Order

1. **Spike the parser.** Validate `node-sql-parser` (transactsql build) against real, moderately complex stored procs before committing to the full port. This is the highest-risk unknown.
2. **Port the core transform to TS**, module-by-module (§5.2), validated against existing `/samples` fixtures for parity with the Python output.
3. **Harden test coverage** — work through §8, especially the parser-edge-case items.
4. **Wire into the extension**, remove all Python-related commands/settings (FR9, FR12), retire the PyPI package.
5. **Tighten warnings/UX** — make unsupported-statement detection loud and clear (FR5, FR10).
6. **Documentation pass** — README rewrite per FR13–FR17, including the "why we dropped Python" architecture note.
7. **Package and publish** — Marketplace listing, versioned release, demo asset.
8. **Portfolio writeup** — a short case-study post/README section: the problem, the architecture decision (static rewrite vs. transaction-wrapper; Node vs. Python backend and why), and what you'd do differently in v2.
