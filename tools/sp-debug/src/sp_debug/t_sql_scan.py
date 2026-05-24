"""Text-based T-SQL construct scanner for gaps sqlglot misses in the AST.

sqlglot often falls back to ``exp.Command`` fragments for TRY/CATCH and nested
blocks, which hides UPDATE and other DML from ``tree.find_all(...)``. This module
supplements the AST with comment-aware line scanning.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

DML_START = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|MERGE)\b",
    re.IGNORECASE,
)
INSERT_TABLE_VAR = re.compile(r"^\s*INSERT\s+INTO\s+@", re.IGNORECASE)
UPDATE_TABLE_VAR = re.compile(r"^\s*UPDATE\s+@", re.IGNORECASE)
DELETE_TABLE_VAR = re.compile(r"^\s*DELETE\s+FROM\s+@", re.IGNORECASE)
BEGIN_TRY = re.compile(r"\bBEGIN\s+TRY\b", re.IGNORECASE)
END_TRY = re.compile(r"\bEND\s+TRY\b", re.IGNORECASE)
BEGIN_CATCH = re.compile(r"\bBEGIN\s+CATCH\b", re.IGNORECASE)
END_CATCH = re.compile(r"\bEND\s+CATCH\b", re.IGNORECASE)

SUMMARY_MAX_LEN = 120


@dataclass
class DmlFinding:
    """A DML statement located by text scan."""

    kind: str
    start_line: int
    end_line: int
    text: str

    def summary(self, max_len: int = SUMMARY_MAX_LEN) -> str:
        one_line = " ".join(self.text.split())
        if len(one_line) > max_len:
            one_line = one_line[: max_len - 3] + "..."
        return f"L{self.start_line}: {one_line}"


@dataclass
class TryCatchFinding:
    """A TRY/CATCH block located by text scan."""

    index: int
    try_line: int
    end_try_line: int
    catch_line: int
    end_catch_line: int

    def summary(self) -> str:
        return (
            f"#{self.index} L{self.try_line}-L{self.end_catch_line}: "
            f"BEGIN TRY (L{self.try_line}) ... END CATCH (L{self.end_catch_line})"
        )


@dataclass
class TsqlScanResult:
    """Findings from text scanning (independent of sqlglot AST)."""

    insert: int = 0
    update: int = 0
    delete: int = 0
    merge: int = 0
    try_catch_blocks: int = 0
    begin_try: int = 0
    end_try: int = 0
    begin_catch: int = 0
    end_catch: int = 0
    dml_findings: list[DmlFinding] = field(default_factory=list)
    try_catch_findings: list[TryCatchFinding] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _strip_line_comment(line: str) -> str:
    """Return line with trailing -- comments removed (string-aware enough for SPs)."""
    out: list[str] = []
    i = 0
    in_string = False
    while i < len(line):
        ch = line[i]
        if ch == "'":
            if in_string and i + 1 < len(line) and line[i + 1] == "'":
                out.append("''")
                i += 2
                continue
            in_string = not in_string
            out.append(ch)
            i += 1
            continue
        if not in_string and ch == "-" and i + 1 < len(line) and line[i + 1] == "-":
            break
        out.append(ch)
        i += 1
    return "".join(out)


def _strip_block_comments(line: str, in_block_comment: bool) -> tuple[str, bool]:
    """Strip block comments and line comments; return scannable text."""
    if in_block_comment:
        end = line.find("*/")
        if end == -1:
            return "", True
        line = line[end + 2 :]
        in_block_comment = False

    while True:
        start = line.find("/*")
        if start == -1:
            break
        end = line.find("*/", start + 2)
        if end == -1:
            return _strip_line_comment(line[:start]), True
        line = line[:start] + line[end + 2 :]

    return _strip_line_comment(line), in_block_comment


def _is_table_variable_dml(first_line: str) -> bool:
    return bool(
        INSERT_TABLE_VAR.match(first_line)
        or UPDATE_TABLE_VAR.match(first_line)
        or DELETE_TABLE_VAR.match(first_line)
    )


def _find_dml_statements(lines: list[str]) -> list[DmlFinding]:
    """Locate DML statements ending with ';' (same boundaries as transform stubbing)."""
    findings: list[DmlFinding] = []
    in_block_comment = False
    i = 0
    while i < len(lines):
        effective, in_block_comment = _strip_block_comments(lines[i], in_block_comment)
        if not effective.strip():
            i += 1
            continue
        if not DML_START.match(effective):
            i += 1
            continue
        if _is_table_variable_dml(effective):
            i += 1
            continue

        start = i
        block_lines = [lines[i]]
        while i < len(lines):
            stmt_line, in_block_comment = _strip_block_comments(lines[i], in_block_comment)
            if ";" in stmt_line:
                break
            i += 1
            if i < len(lines):
                block_lines.append(lines[i])
        if i >= len(lines):
            break

        kind = effective.strip().split()[0].upper()
        findings.append(
            DmlFinding(
                kind=kind,
                start_line=start + 1,
                end_line=i + 1,
                text="\n".join(block_lines),
            )
        )
        i += 1
    return findings


def _try_catch_events(lines: list[str]) -> list[tuple[str, int]]:
    events: list[tuple[str, int]] = []
    in_block_comment = False
    for i, raw in enumerate(lines):
        effective, in_block_comment = _strip_block_comments(raw, in_block_comment)
        if not effective.strip():
            continue
        line_no = i + 1
        if BEGIN_TRY.search(effective):
            events.append(("BEGIN TRY", line_no))
        if END_TRY.search(effective):
            events.append(("END TRY", line_no))
        if BEGIN_CATCH.search(effective):
            events.append(("BEGIN CATCH", line_no))
        if END_CATCH.search(effective):
            events.append(("END CATCH", line_no))
    return events


def _find_try_catch_blocks(lines: list[str]) -> list[TryCatchFinding]:
    events = _try_catch_events(lines)
    findings: list[TryCatchFinding] = []
    idx = 0
    pos = 0
    while pos < len(events):
        if events[pos][0] != "BEGIN TRY":
            pos += 1
            continue

        try_line = events[pos][1]
        end_try_line = catch_line = end_catch_line = 0
        pos += 1
        while pos < len(events) and events[pos][0] != "END TRY":
            pos += 1
        if pos >= len(events):
            break
        end_try_line = events[pos][1]
        pos += 1

        while pos < len(events) and events[pos][0] != "BEGIN CATCH":
            pos += 1
        if pos >= len(events):
            break
        catch_line = events[pos][1]
        pos += 1

        while pos < len(events) and events[pos][0] != "END CATCH":
            pos += 1
        if pos >= len(events):
            break
        end_catch_line = events[pos][1]
        pos += 1

        idx += 1
        findings.append(
            TryCatchFinding(
                index=idx,
                try_line=try_line,
                end_try_line=end_try_line,
                catch_line=catch_line,
                end_catch_line=end_catch_line,
            )
        )
    return findings


def _count_try_catch_keywords(lines: list[str]) -> tuple[int, int, int, int]:
    begin_try = end_try = begin_catch = end_catch = 0
    for kind, _line in _try_catch_events(lines):
        if kind == "BEGIN TRY":
            begin_try += 1
        elif kind == "END TRY":
            end_try += 1
        elif kind == "BEGIN CATCH":
            begin_catch += 1
        elif kind == "END CATCH":
            end_catch += 1
    return begin_try, end_try, begin_catch, end_catch


def scan_tsql(sql: str) -> TsqlScanResult:
    """Scan T-SQL source for constructs that sqlglot may omit from the AST."""
    lines = sql.splitlines()
    dml_findings = _find_dml_statements(lines)
    try_catch_findings = _find_try_catch_blocks(lines)
    begin_try, end_try, begin_catch, end_catch = _count_try_catch_keywords(lines)

    notes: list[str] = []
    if begin_try != end_try or begin_catch != end_catch:
        notes.append(
            "[ScanWarning] Unbalanced TRY/CATCH keywords "
            f"(BEGIN TRY={begin_try}, END TRY={end_try}, "
            f"BEGIN CATCH={begin_catch}, END CATCH={end_catch})."
        )

    insert = sum(1 for f in dml_findings if f.kind == "INSERT")
    update = sum(1 for f in dml_findings if f.kind == "UPDATE")
    delete = sum(1 for f in dml_findings if f.kind == "DELETE")
    merge = sum(1 for f in dml_findings if f.kind == "MERGE")

    return TsqlScanResult(
        insert=insert,
        update=update,
        delete=delete,
        merge=merge,
        try_catch_blocks=len(try_catch_findings),
        begin_try=begin_try,
        end_try=end_try,
        begin_catch=begin_catch,
        end_catch=end_catch,
        dml_findings=dml_findings,
        try_catch_findings=try_catch_findings,
        notes=notes,
    )
