import { highlightTsql } from "../../sqlHighlight";

describe("highlightTsql", () => {
  test("highlights keywords, strings, comments, and variables", () => {
    const html = highlightTsql(
      `-- note\nSELECT @Id FROM dbo.T WHERE Name = N'x'`
    );
    expect(html).toContain('tok-comment');
    expect(html).toContain('tok-keyword');
    expect(html).toContain('tok-var');
    expect(html).toContain('tok-string');
    expect(html).toContain("SELECT");
  });

  test("escapes HTML special characters", () => {
    const html = highlightTsql(`SELECT <script>`);
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).not.toContain("<script>");
  });
});
