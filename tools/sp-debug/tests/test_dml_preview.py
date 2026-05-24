"""Tests for DML SELECT preview generation."""

from pathlib import Path

from sp_debug.dml_preview import build_dml_preview
from sp_debug.transform import transform_sql

SAMPLES = Path(__file__).parents[1] / "samples"


def test_update_preview_for_my_proc():
    sql = (SAMPLES / "my_proc.sql").read_text(encoding="utf-8")
    lines = sql.splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.strip().startswith("UPDATE dbo.Employees"))
    end = start
    while ";" not in lines[end]:
        end += 1
    block = lines[start : end + 1]

    preview = build_dml_preview(block, "        ")
    assert preview is not None
    text = "\n".join(preview)
    assert "[DBG-PREVIEW]" in text
    assert "UPDATE to table dbo.Employees" in text
    assert "AS [calculated-Bonus]" in text
    assert "AS [calculated-LastModified]" in text
    assert "FROM dbo.Employees" in text
    assert "WHERE EmployeeID = @EmployeeID" in text


def test_insert_preview_with_concat():
    block = [
        "        INSERT INTO dbo.AuditLog (EmployeeID, LogMessage, CreatedDate)",
        "        VALUES (@EmployeeID, CONCAT('Bonus processed: $', @BonusAmount), GETDATE());",
    ]
    preview = build_dml_preview(block, "        ")
    assert preview is not None
    text = "\n".join(preview)
    assert "INSERT to table dbo.AuditLog" in text
    assert "AS [@EmployeeID]" in text
    assert "AS [calculated-LogMessage]" in text
    assert "CONCAT(" in text


def test_update_preview_aliases_variables_and_calculations():
    block = [
        "                UPDATE dbo.Orders",
        "                SET OrderStatus = 'Processed',",
        "                    DiscountAmount = @ApplicableDiscount,",
        "                    FinalAmount = @OrderTotal - @ApplicableDiscount,",
        "                    ProcessedDate = GETDATE()",
        "                WHERE OrderID = @CurrentOrderID;",
    ]
    preview = build_dml_preview(block, "                ")
    assert preview is not None
    text = "\n".join(preview)
    assert "'Processed' AS [OrderStatus]" in text
    assert "@ApplicableDiscount AS [@ApplicableDiscount]" in text
    assert "@OrderTotal - @ApplicableDiscount AS [calculated-FinalAmount]" in text
    assert "GETDATE() AS [calculated-ProcessedDate]" in text


def test_update_preview_with_table_alias():
    block = [
        "                UPDATE i",
        "                SET i.StockQuantity = i.StockQuantity - oi.Quantity",
        "                FROM dbo.Inventory i JOIN dbo.OrderItems oi ON i.ProductID = oi.ProductID",
        "                WHERE oi.OrderID = @CurrentOrderID;",
    ]
    preview = build_dml_preview(block, "                ")
    assert preview is not None
    text = "\n".join(preview)
    assert "i.StockQuantity - oi.Quantity AS [calculated-StockQuantity]" in text


def test_transform_my_proc_uses_print_and_select_previews():
    sql = (SAMPLES / "my_proc.sql").read_text(encoding="utf-8")
    result = transform_sql(sql)
    assert "PRINT CONCAT(N'[DBG] @IsSuccess" in result.sql
    assert "RAISERROR(N'[DBG] @IsSuccess" not in result.sql
    assert "[DBG-PREVIEW]" in result.sql
    assert "UPDATE to table dbo.Employees" in result.sql
    assert "INSERT to table dbo.AuditLog" in result.sql
    assert "[DBG-DISABLED]" not in result.sql
