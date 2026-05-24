"""Tests for debug harness transformation."""

import re
from pathlib import Path

from sp_debug.transform import transform_sql

SAMPLES = Path(__file__).parents[1] / "samples"


def _active_dml_lines(sql: str) -> list[str]:
    """Lines with uncommented INSERT/UPDATE/DELETE against non-table-var targets."""
    active = []
    in_block_comment = False
    for line in sql.splitlines():
        stripped = line.strip()
        if "/*" in stripped and "*/" not in stripped:
            in_block_comment = True
        if in_block_comment:
            if "*/" in stripped:
                in_block_comment = False
            continue
        if stripped.startswith("--"):
            continue
        if re.match(r"^(INSERT|UPDATE|DELETE|MERGE)\s+", stripped, re.I):
            if re.match(r"^INSERT\s+INTO\s+@", stripped, re.I):
                continue
            if re.match(r"^UPDATE\s+@", stripped, re.I):
                continue
            active.append(stripped)
    return active


def test_transform_simple_proc_stubs_dml():
    sql = (SAMPLES / "simple_proc.sql").read_text(encoding="utf-8")
    result = transform_sql(sql)
    assert result.stats.dml_stubbed >= 2  # UPDATE dbo.Employees + INSERT dbo.AuditLog
    assert result.stats.traces_added >= 2  # SET @IsSuccess (twice)
    assert "DEBUG HARNESS" in result.sql
    assert "[DBG-PREVIEW]" in result.sql
    assert _active_dml_lines(result.sql) == []


def test_transform_loop_skips_table_variable_insert():
    sql = (SAMPLES / "loop_with_update.sql").read_text(encoding="utf-8")
    result = transform_sql(sql)
    assert result.stats.dml_stubbed >= 3  # dbo DML, not @OrderQueue
    # Table variable insert should remain active
    assert re.search(r"INSERT\s+INTO\s+@OrderQueue", result.sql, re.I)
    assert _active_dml_lines(result.sql) == [] or all(
        "@OrderQueue" in ln or "@OrderQueue" in ln for ln in _active_dml_lines(result.sql)
    )


def test_transform_adds_trace_after_set():
    sql = "CREATE PROC dbo.p AS BEGIN SET @x = 1; END"
    result = transform_sql(sql)
    assert "PRINT CONCAT(N'[DBG] @x" in result.sql
    assert result.stats.traces_added >= 1


def test_transform_reports_progress():
    messages: list[str] = []
    transform_sql("CREATE PROC dbo.p AS BEGIN SET @x = 1; END", on_progress=messages.append)
    assert messages
    assert "Transform started" in messages[0]
    assert any("complete" in message.lower() for message in messages)


def test_transform_block_markers_do_not_skip_lines():
    sql = """
    CREATE PROC dbo.p AS BEGIN
    IF 1=1 SET @x=1;
    WHILE 1=1 SET @y=1;
    END
    """
    result = transform_sql(sql, add_block_markers=True)
    assert result.sql.count("[DBG] Step") == 2
