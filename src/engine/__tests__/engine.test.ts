import * as fs from "fs";
import * as path from "path";
import {
  analyze,
  buildDmlPreview,
  detectUnsupported,
  generate,
} from "../index";

const FIXTURES = path.join(__dirname, "../../../samples/fixtures");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

describe("DML SELECT previews", () => {
  test("INSERT / UPDATE / DELETE rewrite to SELECT previews", () => {
    const result = generate(readFixture("simple_dml.sql"));
    expect(result.sql).toContain("[DBG-PREVIEW]");
    expect(result.sql).toContain("INSERT to table dbo.Items");
    expect(result.sql).toContain("UPDATE to table dbo.Items");
    expect(result.sql).toContain("DELETE from table dbo.Items");
    expect(result.stats.dmlStubbed).toBeGreaterThanOrEqual(3);
  });

  test("UPDATE ... FROM ... JOIN rewrite", () => {
    const result = generate(readFixture("update_join.sql"));
    expect(result.sql).toContain("[DBG-PREVIEW]");
    expect(result.sql).toContain("FROM dbo.Inventory i");
    expect(result.sql).toContain("JOIN dbo.OrderItems oi");
    expect(result.sql).toMatch(/calculated-StockQuantity/);
  });

  test("INSERT preview aliases variables and calculations", () => {
    const block = [
      "        INSERT INTO dbo.AuditLog (EmployeeID, LogMessage, CreatedDate)",
      "        VALUES (@EmployeeID, CONCAT('Bonus processed: $', @BonusAmount), GETDATE());",
    ];
    const preview = buildDmlPreview(block, "        ");
    expect(preview).not.toBeNull();
    const text = preview!.join("\n");
    expect(text).toContain("AS [@EmployeeID]");
    expect(text).toContain("AS [calculated-LogMessage]");
  });
});

describe("TCL neutralization", () => {
  test("BEGIN/COMMIT/ROLLBACK/SAVE TRAN are neutralized", () => {
    const result = generate(readFixture("tcl_nested.sql"));
    expect(result.stats.tclNeutralized).toBeGreaterThanOrEqual(4);
    expect(result.sql).toContain("[DBG-TCL]");
    expect(result.sql).not.toMatch(/^\s*COMMIT TRANSACTION/m);
    expect(result.sql).not.toMatch(/^\s*BEGIN TRANSACTION/m);
  });
});

describe("TRY/CATCH and temp objects", () => {
  test("TRY/CATCH wrapping DML still rewrites DML", () => {
    const result = generate(readFixture("try_catch_dml.sql"));
    expect(result.sql).toContain("[DBG-PREVIEW]");
    expect(result.sql).toContain("INSERT to table dbo.T");
    expect(result.sql).toContain("BEGIN TRY");
  });

  test("temp tables rewritten; table-variable DML left alone", () => {
    const result = generate(readFixture("temp_table_var.sql"));
    expect(result.sql).toContain("#Temp");
    // table variable INSERT INTO @TV should not be stubbed as preview for real tables
    expect(result.sql).toMatch(/INSERT\s+INTO\s+@TV/i);
    expect(result.sql).toContain("[DBG-PREVIEW]");
  });
});

describe("unsupported detection", () => {
  test("dynamic SQL and cursor are flagged", () => {
    const sql = readFixture("dynamic_cursor.sql");
    const findings = detectUnsupported(sql);
    expect(findings.some((f) => f.kind === "dynamic_sql")).toBe(true);
    expect(findings.some((f) => f.kind === "cursor")).toBe(true);
    expect(findings.some((f) => f.kind === "while")).toBe(true);

    const report = analyze(sql);
    const msgs = report.warnings.map((w) => w.message).join("\n");
    expect(msgs).toMatch(/Dynamic SQL/i);
    expect(msgs).toMatch(/Cursor/i);
  });

  test("MERGE is flagged and disabled", () => {
    const result = generate(readFixture("cte_merge.sql"));
    expect(result.stats.warnings.some((w) => /MERGE/i.test(w))).toBe(true);
    expect(result.sql).toMatch(/\[DBG-DISABLED\].*MERGE|DBG\] Skipped MERGE/i);
  });

  test("OUTPUT clause produces a warning", () => {
    const findings = detectUnsupported(readFixture("output_clause.sql"));
    expect(findings.some((f) => f.kind === "output_clause")).toBe(true);
  });
});

describe("pass-through and errors", () => {
  test("pure SELECT proc has no DML stubs", () => {
    const result = generate(readFixture("pure_select.sql"));
    expect(result.stats.dmlStubbed).toBe(0);
    expect(result.sql).toContain("SELECT Id, Name FROM dbo.Items");
    expect(result.sql).toContain("DEBUG HARNESS");
  });

  test("malformed input does not crash", () => {
    expect(() => generate("CREATE PROCEDURE ((((")).not.toThrow();
    expect(() => analyze("%%% not sql %%%")).not.toThrow();
    const report = analyze("%%% not sql %%%");
    expect(report.plainText).toContain("Analysis Report");
  });

  test("my_proc fixture produces PRINT traces and previews", () => {
    const result = generate(readFixture("my_proc.sql"), {
      traceStyle: "print",
    });
    expect(result.sql).toContain("[DBG-PREVIEW]");
    expect(result.sql).toContain("UPDATE to table dbo.Employees");
    expect(result.sql).toContain("INSERT to table dbo.AuditLog");
    expect(result.sql).toMatch(/PRINT CONCAT\(N'\[DBG\] @IsSuccess/);
  });
});

describe("CREATE PROCEDURE → DECLARE", () => {
  test("multiple params become one comma-separated DECLARE (no mid-list semicolons)", () => {
    const sql = `
CREATE PROCEDURE dbo.usp_Multi
    @Id INT,
    @Name NVARCHAR(100)
AS
BEGIN
    SELECT @Id, @Name;
END
`.trim();
    const result = generate(sql);
    expect(result.sql).toMatch(/DECLARE @Id INT = NULL,/);
    expect(result.sql).toMatch(/@Name NVARCHAR\(100\) = NULL;/);
    expect(result.sql).not.toMatch(/DECLARE @Id INT = NULL;\s*\n\s*DECLARE @Name/);
    expect(result.sql).not.toMatch(/INT; =/);
  });

  test("OUTPUT / OUT params are stripped from type and annotated", () => {
    const sql = `
CREATE PROCEDURE dbo.usp_WithOut
(
    @InId INT,
    @OutCount INT OUTPUT,
    @OutFlag BIT = 0 OUT
)
AS
BEGIN
    SET @OutCount = 1;
END
`.trim();
    const result = generate(sql);
    expect(result.sql).toMatch(/DECLARE @InId INT = NULL,/);
    expect(result.sql).toMatch(/@OutCount INT = NULL,/);
    expect(result.sql).toMatch(/@OutFlag BIT = 0;/);
    expect(result.sql).toMatch(/-- OUTPUT/);
    expect(result.sql).not.toMatch(/INT OUTPUT\s*=/);
    expect(result.sql).not.toMatch(/=\s*0\s+OUT\b/i);
    expect(result.sql).not.toContain("(no parameters)");
  });

  test("trailing semicolons on param lines do not leak into DECLARE", () => {
    const sql = `
CREATE PROCEDURE dbo.usp_Semi
    @A INT;,
    @B VARCHAR(20);
AS
BEGIN
    SELECT 1;
END
`.trim();
    const result = generate(sql);
    expect(result.sql).toMatch(/DECLARE @A INT = NULL,/);
    expect(result.sql).toMatch(/@B VARCHAR\(20\) = NULL;/);
    expect(result.sql).not.toMatch(/INT; =/);
    expect(result.sql).not.toMatch(/VARCHAR\(20\); =/);
  });
});

describe("analyze report shape", () => {
  test("summary includes DML counts", () => {
    const report = analyze(readFixture("simple_dml.sql"));
    expect(report.isParsable).toBe(true);
    const insert = report.summary.find((r) => r.element === "INSERT");
    expect(insert && Number(insert.count)).toBeGreaterThanOrEqual(1);
    expect(report.identified.some((r) => r.kind === "INSERT")).toBe(true);
  });
});
