"""Tests for inventory report formatting."""

from sp_debug.inventory import InventoryReport


def test_to_text_non_zero_only_hides_zeros():
    inv = InventoryReport(
        parse_ok=True,
        insert=1,
        update=0,
        set_variable=2,
        command_fragments=4,
        details={
            "INSERT": ["L10: INSERT INTO dbo.Foo VALUES (1)"],
            "SET (@variables)": ["L5: SET @x = 1", "L6: SET @y = 2"],
            "Command fragments (partial)": ["L1: BEGIN TRY ..."],
        },
    )
    text = inv.to_text(non_zero_only=True)
    assert "Summary" in text
    assert "Identified" in text
    assert "INSERT" in text
    assert "dbo.Foo" in text
    assert "SET (@variables)" in text
    assert "Command fragments" in text
    assert "UPDATE" not in text.split("Identified", 1)[0]
    assert "-->" not in text


def test_to_text_full_shows_zeros():
    inv = InventoryReport(parse_ok=True, insert=1, update=0)
    text = inv.to_text(non_zero_only=False)
    assert "UPDATE" in text
    assert "0" in text


def test_to_text_colorize_adds_ansi():
    inv = InventoryReport(parse_ok=True, insert=2, update=0)
    text = inv.to_text(colorize=True, non_zero_only=False)
    assert "\033[32m" in text
    assert "\033[31m" in text


def test_to_text_plain_has_no_ansi():
    inv = InventoryReport(parse_ok=False, insert=1)
    text = inv.to_text(colorize=False, non_zero_only=True)
    assert "\033[" not in text
    assert "parse_ok" in text
    assert "INSERT" in text


def test_to_text_issues_table():
    inv = InventoryReport(
        parse_ok=True,
        warnings=["warn one"],
        errors=["err one"],
    )
    text = inv.to_text()
    assert "Warnings & Errors" in text
    assert "warn one" in text
    assert "err one" in text
