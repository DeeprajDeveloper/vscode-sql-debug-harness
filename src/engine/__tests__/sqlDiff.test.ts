import {
  diffLines,
  diffSqlForCompare,
  filterLinesForCompare,
  isCompareNoiseLine,
  normalizeCompareKey,
} from "../../sqlDiff";

describe("sqlDiff noise filtering", () => {
  test("drops blanks, banner, and non-DBG comments", () => {
    expect(isCompareNoiseLine("")).toBe(true);
    expect(isCompareNoiseLine("   ")).toBe(true);
    expect(isCompareNoiseLine("-- ========================================")).toBe(
      true
    );
    expect(
      isCompareNoiseLine("-- DEBUG HARNESS — DO NOT RUN ON PRODUCTION")
    ).toBe(true);
    expect(isCompareNoiseLine("-- plain comment")).toBe(true);
    expect(isCompareNoiseLine("-- [DBG-PREVIEW] Would have executed:")).toBe(
      false
    );
    expect(isCompareNoiseLine("    SELECT 1;")).toBe(false);
  });

  test("normalizeCompareKey collapses whitespace/case", () => {
    expect(normalizeCompareKey("  SET   @A = 1; ")).toBe("set @a = 1;");
  });

  test("filterLinesForCompare keeps meaningful lines only", () => {
    const text = `
-- ========================================
-- DEBUG HARNESS — DO NOT RUN ON PRODUCTION
-- ========================================

DECLARE @Id INT = NULL;
-- [DBG-PREVIEW] Would have executed:
SELECT 1;

-- trailing note
`.trim();
    expect(filterLinesForCompare(text)).toEqual([
      "DECLARE @Id INT = NULL;",
      "-- [DBG-PREVIEW] Would have executed:",
      "SELECT 1;",
    ]);
  });
});

describe("diffLines / diffSqlForCompare", () => {
  test("detects add and remove", () => {
    const rows = diffLines(
      ["A", "B", "C"],
      ["A", "X", "C"]
    );
    expect(rows).toEqual([
      { kind: "equal", left: "A", right: "A" },
      { kind: "remove", left: "B" },
      { kind: "add", right: "X" },
      { kind: "equal", left: "C", right: "C" },
    ]);
  });

  test("source vs harness ignores banner noise", () => {
    const source = `
CREATE PROCEDURE dbo.usp_T
    @Id INT
AS
BEGIN
    INSERT INTO dbo.T (Id) VALUES (@Id);
END
`.trim();
    const debug = `
-- ========================================
-- DEBUG HARNESS — DO NOT RUN ON PRODUCTION
-- ========================================
-- [DBG] Harness: was CREATE PROCEDURE dbo.usp_T
DECLARE @Id INT = NULL;
    -- [DBG-PREVIEW] Would have executed:
    SELECT N'INSERT to table dbo.T' AS [DBG_Action], @Id AS [@Id];
`.trim();
    const { rows, stats } = diffSqlForCompare(source, debug);
    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
    expect(rows.some((r) => r.kind === "add" && /DBG-PREVIEW/.test(r.right ?? ""))).toBe(
      true
    );
    expect(
      rows.some((r) => /DEBUG HARNESS/.test(r.left ?? "") || /DEBUG HARNESS/.test(r.right ?? ""))
    ).toBe(false);
  });
});
