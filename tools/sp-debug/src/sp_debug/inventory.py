"""AST inventory pass for stored procedure analysis (Phase 0)."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Iterator

from sqlglot import exp

from sp_debug.console import failure, heading, success, warning
from sp_debug.parse import ParseResult, parse_sql, root_tree
from sp_debug.t_sql_scan import TsqlScanResult, scan_tsql

COUNT_SECTIONS: tuple[tuple[str, str], ...] = (
    ("INSERT", "insert"),
    ("UPDATE", "update"),
    ("DELETE", "delete"),
    ("MERGE", "merge"),
    ("TRY/CATCH blocks", "try_catch_blocks"),
    ("IF", "if_count"),
    ("WHILE", "while_count"),
    ("SET (all)", "set_count"),
    ("SET (@variables)", "set_variable"),
    ("SELECT @assignments", "select_assign"),
    ("Command fragments (partial)", "command_fragments"),
)

SCAN_SECTIONS: tuple[tuple[str, str], ...] = (
    ("scan INSERT", "scan_insert"),
    ("scan UPDATE", "scan_update"),
    ("scan DELETE", "scan_delete"),
    ("scan MERGE", "scan_merge"),
)

def _truncate_sql(text: str, max_len: int = 120) -> str:
    one_line = " ".join(text.split())
    if len(one_line) > max_len:
        return one_line[: max_len - 3] + "..."
    return one_line


def _node_line(node: exp.Expression) -> str | None:
    line = node.meta.get("line") if getattr(node, "meta", None) else None
    if line is not None:
        return f"L{line}: "
    return None


def _plain_len(text: str) -> int:
    """Length of text without ANSI escape sequences."""
    return len(re.sub(r"\033\[[0-9;]*m", "", text))


def _render_table(
    title: str,
    headers: tuple[str, ...],
    rows: list[tuple[str, ...]],
    *,
    colorize: bool,
    style_row: Callable[[tuple[str, ...], str, bool], str] | None = None,
) -> list[str]:
    """Render a simple fixed-width table."""
    if not rows:
        return []

    widths = [_plain_len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], _plain_len(cell))

    def fmt_row(cells: tuple[str, ...]) -> str:
        parts: list[str] = []
        for i, cell in enumerate(cells):
            pad = widths[i] - _plain_len(cell) + len(cell)
            parts.append(cell.ljust(pad))
        return "  " + "  ".join(parts)

    sep = "  " + "  ".join("-" * w for w in widths)
    title_line = heading(title, enabled=colorize) if colorize else title
    out = ["", title_line, fmt_row(headers), sep]
    for row in rows:
        line = fmt_row(row)
        if style_row is not None:
            line = style_row(row, line, colorize)
        out.append(line)
    return out


@dataclass
class InventoryReport:
    """Counts of structural elements in a T-SQL script."""

    parse_ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    insert: int = 0
    update: int = 0
    delete: int = 0
    merge: int = 0
    if_count: int = 0
    while_count: int = 0
    set_count: int = 0
    set_variable: int = 0
    select_assign: int = 0
    command_fragments: int = 0
    try_catch_blocks: int = 0
    scan_insert: int = 0
    scan_update: int = 0
    scan_delete: int = 0
    scan_merge: int = 0
    details: dict[str, list[str]] = field(default_factory=dict)

    def _count_sections(self) -> Iterator[tuple[str, int]]:
        for label, attr in COUNT_SECTIONS:
            yield label, int(getattr(self, attr))

    def _scan_sections(self) -> Iterator[tuple[str, int]]:
        for label, attr in SCAN_SECTIONS:
            yield label, int(getattr(self, attr))

    def _summary_rows(self, *, non_zero_only: bool) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = [("parse_ok", str(self.parse_ok))]
        for label, value in self._count_sections():
            if non_zero_only and value == 0:
                continue
            rows.append((label, str(value)))
        for label, value in self._scan_sections():
            if non_zero_only and value == 0:
                continue
            rows.append((label, str(value)))
        return rows

    def _issue_rows(self) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = []
        for err in self.errors:
            rows.append(("Error", err))
        for warn in self.warnings:
            rows.append(("Warning", warn))
        return rows

    def _identified_rows(self) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = []
        seen: set[str] = set()
        for label, _attr in COUNT_SECTIONS:
            for detail in self.details.get(label, []):
                rows.append((label, detail))
            seen.add(label)
        for label, items in self.details.items():
            if label in seen:
                continue
            for detail in items:
                rows.append((label, detail))
        return rows

    def _style_summary_row(
        self, row: tuple[str, ...], line: str, colorize: bool
    ) -> str:
        if not colorize:
            return line
        label, value = row[0], row[1]
        if label == "parse_ok":
            return success(line, enabled=True) if value == "True" else failure(line, enabled=True)
        try:
            numeric = int(value)
        except ValueError:
            return line
        if numeric > 0:
            return success(line, enabled=True)
        return failure(line, enabled=True)

    def _style_issue_row(self, row: tuple[str, ...], line: str, colorize: bool) -> str:
        if not colorize:
            return line
        if row[0] == "Error":
            return failure(line, enabled=True)
        return warning(line, enabled=True)

    def to_text(self, *, colorize: bool = False, non_zero_only: bool = False) -> str:
        """Render inventory report in three sections: summary, issues, identified."""
        lines: list[str] = [
            heading("SP Debug — Inventory Report", enabled=colorize)
            if colorize
            else "SP Debug — Inventory Report",
            "-" * 72,
        ]

        summary = self._summary_rows(non_zero_only=non_zero_only)
        lines.extend(
            _render_table(
                "Summary",
                ("Element", "Count"),
                summary,
                colorize=colorize,
                style_row=self._style_summary_row,
            )
        )

        issues = self._issue_rows()
        lines.extend(
            _render_table(
                "Warnings & Errors",
                ("Type", "Message"),
                issues if issues else [("—", "None")],
                colorize=colorize,
                style_row=self._style_issue_row if issues else None,
            )
        )

        identified = self._identified_rows()
        if identified:
            lines.extend(
                _render_table(
                    "Identified",
                    ("Kind", "Detail"),
                    identified,
                    colorize=colorize,
                )
            )
        elif non_zero_only and not summary:
            lines.append("")
            lines.append(
                success("  No structural elements detected.", enabled=colorize)
                if colorize
                else "  No structural elements detected."
            )

        lines.append("-" * 72)
        return "\n".join(lines)


def _count_select_assignments(tree: exp.Expression) -> int:
    count = 0
    for sel in tree.find_all(exp.Select):
        for expr in sel.expressions:
            if isinstance(expr, exp.EQ) and _is_variable(expr.left):
                count += 1
    return count


def _is_variable(node: exp.Expression) -> bool:
    if isinstance(node, exp.Var):
        return node.name.startswith("@")
    if isinstance(node, exp.Parameter) and isinstance(node.this, exp.Var):
        return node.this.name.startswith("@")
    return False


def _count_set_variables(tree: exp.Expression) -> int:
    count = 0
    for node in tree.find_all(exp.Set):
        sql = node.sql(dialect="tsql").upper()
        if "NOCOUNT" in sql:
            continue
        if "@" in sql:
            count += 1
    return count


def _merge_dml_count(ast_count: int, scan_count: int) -> int:
    """Prefer the higher count when sqlglot misses DML inside Command fragments."""
    return max(ast_count, scan_count)


def _collect_ast_details(tree: exp.Expression) -> dict[str, list[str]]:
    """Extract one-line summaries from sqlglot AST nodes."""
    details: dict[str, list[str]] = {}

    for node in tree.find_all(exp.Insert):
        prefix = _node_line(node) or ""
        details.setdefault("INSERT", []).append(
            prefix + _truncate_sql(node.sql(dialect="tsql"))
        )

    for node in tree.find_all(exp.Update):
        prefix = _node_line(node) or ""
        details.setdefault("UPDATE", []).append(
            prefix + _truncate_sql(node.sql(dialect="tsql"))
        )

    for node in tree.find_all(exp.Delete):
        prefix = _node_line(node) or ""
        details.setdefault("DELETE", []).append(
            prefix + _truncate_sql(node.sql(dialect="tsql"))
        )

    for node in tree.find_all(exp.Merge):
        prefix = _node_line(node) or ""
        details.setdefault("MERGE", []).append(
            prefix + _truncate_sql(node.sql(dialect="tsql"))
        )

    for node in tree.find_all(exp.If):
        prefix = _node_line(node) or ""
        details.setdefault("IF", []).append(prefix + _truncate_sql(node.sql(dialect="tsql")))

    for node in tree.find_all(exp.WhileBlock):
        prefix = _node_line(node) or ""
        details.setdefault("WHILE", []).append(
            prefix + _truncate_sql(node.sql(dialect="tsql"))
        )

    for node in tree.find_all(exp.Set):
        sql = node.sql(dialect="tsql")
        if "NOCOUNT" in sql.upper():
            continue
        if "@" not in sql:
            continue
        prefix = _node_line(node) or ""
        details.setdefault("SET (@variables)", []).append(prefix + _truncate_sql(sql))

    for sel in tree.find_all(exp.Select):
        assigns: list[str] = []
        for expr in sel.expressions:
            if isinstance(expr, exp.EQ) and _is_variable(expr.left):
                var = expr.left
                if isinstance(var, exp.Parameter) and isinstance(var.this, exp.Var):
                    var = var.this
                if isinstance(var, exp.Var):
                    assigns.append(var.name)
        if assigns:
            prefix = _node_line(sel) or ""
            details.setdefault("SELECT @assignments", []).append(
                prefix + _truncate_sql(sel.sql(dialect="tsql"))
            )

    for node in tree.find_all(exp.Command):
        prefix = _node_line(node) or ""
        details.setdefault("Command fragments (partial)", []).append(
            prefix + _truncate_sql(node.sql(dialect="tsql"))
        )

    return details


def _collect_scan_details(scan: TsqlScanResult) -> dict[str, list[str]]:
    """Extract statement summaries from text scan (covers sqlglot gaps)."""
    details: dict[str, list[str]] = {}

    for finding in scan.dml_findings:
        details.setdefault(finding.kind, []).append(finding.summary())

    for finding in scan.try_catch_findings:
        details.setdefault("TRY/CATCH blocks", []).append(finding.summary())

    return details


INSERT_TARGET = re.compile(r"INSERT\s+INTO\s+(\S+)", re.IGNORECASE)
UPDATE_TARGET = re.compile(r"UPDATE\s+(\S+)", re.IGNORECASE)
DELETE_TARGET = re.compile(r"DELETE\s+FROM\s+(\S+)", re.IGNORECASE)
MERGE_TARGET = re.compile(r"MERGE\s+(\S+)", re.IGNORECASE)


def _detail_text(detail: str) -> str:
    text = re.sub(r"^L\d+:\s*", "", detail)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return " ".join(text.split())


def _detail_line(detail: str) -> int | None:
    match = re.match(r"^L(\d+):", detail)
    return int(match.group(1)) if match else None


def _dml_kind_target(detail: str) -> tuple[str, str] | None:
    text = _detail_text(detail).upper()
    for pattern, kind in (
        (INSERT_TARGET, "INSERT"),
        (UPDATE_TARGET, "UPDATE"),
        (DELETE_TARGET, "DELETE"),
        (MERGE_TARGET, "MERGE"),
    ):
        match = pattern.search(text)
        if match:
            return kind, match.group(1)
    return None


def _pick_best_detail(items: list[str]) -> str:
    """Prefer line-numbered scan text, then the least-truncated variant."""
    line_items = [item for item in items if _detail_line(item) is not None]
    pool = line_items or items
    return max(pool, key=lambda item: (len(_detail_text(item)), len(item)))


def _merge_dml_detail_lists(
    scan_items: list[str],
    ast_items: list[str],
) -> list[str]:
    """Union scan + AST DML details; merge duplicates by kind/target/line."""
    buckets: dict[tuple[str, str, int | None], list[str]] = {}
    order: list[tuple[str, str, int | None]] = []
    fallback: list[str] = []
    fallback_seen: set[str] = set()

    def add_to_bucket(key: tuple[str, str, int | None], item: str) -> None:
        if key not in buckets:
            order.append(key)
            buckets[key] = []
        buckets[key].append(item)

    for item in scan_items + ast_items:
        kind_target = _dml_kind_target(item)
        if kind_target is None:
            key = _detail_text(item).upper()
            if key in fallback_seen:
                continue
            fallback_seen.add(key)
            fallback.append(item)
            continue

        kind, target = kind_target
        line = _detail_line(item)
        if line is None:
            lined_keys = [
                key
                for key in order
                if key[0] == kind and key[1] == target and key[2] is not None
            ]
            if len(lined_keys) == 1:
                add_to_bucket(lined_keys[0], item)
                continue

        add_to_bucket((kind, target, line), item)

    merged = [_pick_best_detail(buckets[key]) for key in order]
    merged.extend(fallback)
    return merged


def _merge_details(
    ast_details: dict[str, list[str]],
    scan_details: dict[str, list[str]],
) -> dict[str, list[str]]:
    """Merge AST and text-scan findings; union DML details to match merged counts."""
    merged: dict[str, list[str]] = {}

    dml_kinds = ("INSERT", "UPDATE", "DELETE", "MERGE")
    for kind in dml_kinds:
        combined = _merge_dml_detail_lists(
            scan_details.get(kind, []),
            ast_details.get(kind, []),
        )
        if combined:
            merged[kind] = combined

    if scan_details.get("TRY/CATCH blocks"):
        merged["TRY/CATCH blocks"] = list(scan_details["TRY/CATCH blocks"])
    elif ast_details.get("TRY/CATCH blocks"):
        merged["TRY/CATCH blocks"] = list(ast_details["TRY/CATCH blocks"])

    for label, items in ast_details.items():
        if label in merged or label in dml_kinds or label == "TRY/CATCH blocks":
            continue
        merged[label] = list(items)

    return merged


def _apply_scan(report: InventoryReport, scan: TsqlScanResult) -> None:
    report.scan_insert = scan.insert
    report.scan_update = scan.update
    report.scan_delete = scan.delete
    report.scan_merge = scan.merge
    report.try_catch_blocks = scan.try_catch_blocks
    report.insert = _merge_dml_count(report.insert, scan.insert)
    report.update = _merge_dml_count(report.update, scan.update)
    report.delete = _merge_dml_count(report.delete, scan.delete)
    report.merge = _merge_dml_count(report.merge, scan.merge)


def inventory_from_sql(sql: str) -> InventoryReport:
    result = parse_sql(sql)
    return inventory_from_parse(result)


def inventory_from_parse(result: ParseResult) -> InventoryReport:
    tree = root_tree(result)
    scan = result.scan or scan_tsql(result.source)
    report = InventoryReport(
        parse_ok=result.ok,
        errors=list(result.errors),
        warnings=list(result.warnings),
    )
    ast_details: dict[str, list[str]] = {}
    if tree is not None:
        report.insert = len(list(tree.find_all(exp.Insert)))
        report.update = len(list(tree.find_all(exp.Update)))
        report.delete = len(list(tree.find_all(exp.Delete)))
        report.merge = len(list(tree.find_all(exp.Merge)))
        report.if_count = len(list(tree.find_all(exp.If)))
        report.while_count = len(list(tree.find_all(exp.WhileBlock)))
        report.set_count = len(list(tree.find_all(exp.Set)))
        report.set_variable = _count_set_variables(tree)
        report.select_assign = _count_select_assignments(tree)
        report.command_fragments = len(list(tree.find_all(exp.Command)))
        ast_details = _collect_ast_details(tree)

    _apply_scan(report, scan)
    report.details = _merge_details(ast_details, _collect_scan_details(scan))
    return report
