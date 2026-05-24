"""Convert DML statements into safe SELECT previews for debug harness scripts."""

from __future__ import annotations

import re

CLAUSE_FROM = re.compile(r"\bFROM\b", re.IGNORECASE)
CLAUSE_WHERE = re.compile(r"\bWHERE\b", re.IGNORECASE)
CLAUSE_SET = re.compile(r"\bSET\b", re.IGNORECASE)
INSERT_INTO = re.compile(r"^\s*INSERT\s+INTO\s+(\S+)", re.IGNORECASE)
DELETE_FROM = re.compile(
    r"^\s*DELETE\s+FROM\s+(\S+)(?:\s+WHERE\s+(.+))?\s*;?\s*$",
    re.IGNORECASE | re.DOTALL,
)


def _extract_paren_content(text: str, open_index: int) -> tuple[str, int] | None:
    if open_index >= len(text) or text[open_index] != "(":
        return None
    depth = 0
    for i in range(open_index, len(text)):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : i], i + 1
    return None


def _block_sql(block_lines: list[str]) -> str:
    parts = [ln.strip() for ln in block_lines if ln.strip()]
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def _find_clause(text: str, pattern: re.Pattern[str]) -> int | None:
    match = pattern.search(text)
    return match.start() if match else None


def _split_expressions(text: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
            continue
        current.append(ch)
    tail = "".join(current).strip()
    if tail:
        parts.append(tail)
    return parts


def _parse_assignments(set_clause: str) -> list[tuple[str, str]]:
    assignments: list[tuple[str, str]] = []
    for part in _split_expressions(set_clause):
        if "=" not in part:
            continue
        lhs, rhs = part.split("=", 1)
        assignments.append((lhs.strip(), rhs.strip()))
    return assignments


def _column_alias(name: str) -> str:
    base = name.split(".")[-1].strip("[]")
    return f"[{base}]"


_BARE_VAR = re.compile(r"^@\w+$", re.IGNORECASE)
_QUOTED_LITERAL = re.compile(r"^(N?'([^']|'')*'|\d+(\.\d+)?)$", re.IGNORECASE)


def _lhs_column_name(lhs: str) -> str:
    return lhs.split(".")[-1].strip("[]")


def _is_calculation(expr: str) -> bool:
    """True when RHS is an expression, not a bare variable or simple literal."""
    text = expr.strip()
    if _BARE_VAR.match(text):
        return False
    if _QUOTED_LITERAL.match(text):
        return False
    if re.search(r"[\+\-\*/%]|^\w+\(", text, re.IGNORECASE):
        return True
    return False


def _preview_column_alias(lhs: str, rhs: str) -> str:
    """Choose preview column alias based on SET/VALUES expression shape."""
    rhs = rhs.strip()
    if _BARE_VAR.match(rhs):
        return f"[{rhs}]"
    col = _lhs_column_name(lhs)
    if _is_calculation(rhs):
        return f"[calculated-{col}]"
    return f"[{col}]"


def _parse_update(sql: str) -> dict[str, str | list[tuple[str, str]]] | None:
    text = sql.strip().rstrip(";")
    if not re.match(r"UPDATE\b", text, re.I):
        return None

    rest = re.sub(r"^UPDATE\s+", "", text, flags=re.I).strip()
    set_match = CLAUSE_SET.search(rest)
    if not set_match:
        return None

    target = rest[: set_match.start()].strip()
    after_set = rest[set_match.end() :].strip()
    from_pos = _find_clause(after_set, CLAUSE_FROM)
    where_pos = _find_clause(after_set, CLAUSE_WHERE)
    stops = [pos for pos in (from_pos, where_pos) if pos is not None]
    assign_end = min(stops) if stops else len(after_set)

    assignments = _parse_assignments(after_set[:assign_end])
    if not assignments:
        return None

    from_clause = ""
    if from_pos is not None:
        from_end = where_pos if where_pos is not None and where_pos > from_pos else len(after_set)
        from_clause = after_set[from_pos:from_end].strip()

    where_clause = ""
    if where_pos is not None:
        where_clause = after_set[where_pos:].strip()

    return {
        "kind": "UPDATE",
        "target": target,
        "assignments": assignments,
        "from_clause": from_clause,
        "where_clause": where_clause,
    }


def _parse_insert(sql: str) -> dict[str, str | list[str]] | None:
    one_line = re.sub(r"\s+", " ", sql.strip().rstrip(";"))
    head = INSERT_INTO.match(one_line)
    if not head:
        return None

    table = head.group(1)
    pos = head.end()
    while pos < len(one_line) and one_line[pos].isspace():
        pos += 1
    columns: list[str] = []

    if pos < len(one_line) and one_line[pos] == "(":
        col_content, pos = _extract_paren_content(one_line, pos) or ("", pos)
        columns = [c.strip() for c in col_content.split(",") if c.strip()]

    values_match = re.search(r"\bVALUES\b", one_line[pos:], re.I)
    if not values_match:
        return None
    pos += values_match.end()
    while pos < len(one_line) and one_line[pos].isspace():
        pos += 1

    values_content, _end = _extract_paren_content(one_line, pos) or ("", pos)
    values = _split_expressions(values_content)
    if not values:
        return None
    if columns and len(columns) != len(values):
        return None
    if not columns:
        columns = [f"col{i + 1}" for i in range(len(values))]

    return {
        "kind": "INSERT",
        "target": table,
        "columns": columns,
        "values": values,
    }


def _parse_delete(sql: str) -> dict[str, str] | None:
    one_line = re.sub(r"\s+", " ", sql.strip().rstrip(";"))
    match = DELETE_FROM.match(one_line)
    if not match:
        return None
    return {
        "kind": "DELETE",
        "target": match.group(1),
        "where_clause": (match.group(2) or "").strip(),
    }


def _format_multiline(indent: str, sql: str) -> list[str]:
    return [f"{indent}{line}" if line else "" for line in sql.splitlines()]


def build_dml_preview(block_lines: list[str], indent: str) -> list[str] | None:
    """Return SELECT preview lines replacing a DML block, or None if unsupported."""
    sql = _block_sql(block_lines)
    first = block_lines[0].strip().split()[0].upper()

    if first == "UPDATE":
        parsed = _parse_update(sql)
        if parsed is None:
            return None
        target = str(parsed["target"])
        assignments = parsed["assignments"]
        assert isinstance(assignments, list)

        select_cols = [f"N'UPDATE to table {target}' AS [DBG_Action]"]
        for lhs, rhs in assignments:
            select_cols.append(f"{rhs} AS {_preview_column_alias(str(lhs), str(rhs))}")

        from_clause = str(parsed.get("from_clause") or "")
        if from_clause:
            from_sql = from_clause
        else:
            from_sql = f"FROM {target}"

        where_clause = str(parsed.get("where_clause") or "").strip()
        preview = (
            f"SELECT {', '.join(select_cols)}\n"
            f"{from_sql}"
            + (f"\n{where_clause}" if where_clause else "")
            + ";"
        )
        return [
            f"{indent}-- [DBG-PREVIEW] Would have executed:",
            *_format_multiline(indent, preview),
        ]

    if first == "INSERT":
        parsed = _parse_insert(sql)
        if parsed is None:
            return None
        target = str(parsed["target"])
        columns = parsed["columns"]
        values = parsed["values"]
        assert isinstance(columns, list) and isinstance(values, list)

        select_cols = [f"N'INSERT to table {target}' AS [DBG_Action]"]
        for col, val in zip(columns, values, strict=True):
            select_cols.append(f"{val} AS {_preview_column_alias(str(col), str(val))}")

        preview = f"SELECT {', '.join(select_cols)};"
        return [
            f"{indent}-- [DBG-PREVIEW] Would have executed:",
            *_format_multiline(indent, preview),
        ]

    if first == "DELETE":
        parsed = _parse_delete(sql)
        if parsed is None:
            return None
        target = str(parsed["target"])
        where_clause = str(parsed.get("where_clause") or "").strip()
        select_cols = [f"N'DELETE from table {target}' AS [DBG_Action]", "*"]
        preview = (
            f"SELECT {', '.join(select_cols)}\n"
            f"FROM {target}"
            + (f"\nWHERE {where_clause}" if where_clause else "")
            + ";"
        )
        return [
            f"{indent}-- [DBG-PREVIEW] Would have executed:",
            *_format_multiline(indent, preview),
        ]

    return None
