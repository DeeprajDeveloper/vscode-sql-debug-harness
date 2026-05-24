"""Tests for inventory pass."""

from pathlib import Path

from sp_debug.inventory import inventory_from_sql

SAMPLES = Path(__file__).parents[1] / "samples"


def test_simple_proc_inventory_parses():
    sql = (SAMPLES / "simple_proc.sql").read_text(encoding="utf-8")
    inv = inventory_from_sql(sql)
    assert inv.parse_ok
    assert inv.insert >= 1
    assert inv.set_variable >= 2


def test_loop_proc_inventory():
    sql = (SAMPLES / "loop_with_update.sql").read_text(encoding="utf-8")
    inv = inventory_from_sql(sql)
    assert inv.parse_ok
    assert inv.while_count >= 1
    assert inv.set_variable >= 5
