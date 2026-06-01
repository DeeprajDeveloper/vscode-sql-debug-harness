export interface AnalyzeSummaryRow {
  element: string;
  count: string;
}

export interface AnalyzeWarningRow {
  type: string;
  message: string;
}

export interface AnalyzeIdentifiedRow {
  kind: string;
  detail: string;
  line?: number;
}

export interface AnalyzeReport {
  title: string;
  summary: AnalyzeSummaryRow[];
  warnings: AnalyzeWarningRow[];
  identified: AnalyzeIdentifiedRow[];
}

const SECTION_SUMMARY = "Summary";
const SECTION_WARNINGS = "Warnings & Errors";
const SECTION_IDENTIFIED = "Identified";

function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^-+$/.test(trimmed);
}

function isTableRuleLine(line: string): boolean {
  return /^\s*\S+\s+-{3,}/.test(line);
}

function splitColumns(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(.+?)\s{2,}(.+)$/);
  if (!match) {
    return null;
  }
  return [match[1].trim(), match[2].trim()];
}

function parseLineNumber(detail: string): number | undefined {
  const match = detail.match(/^L(\d+):/);
  if (match) {
    return parseInt(match[1], 10);
  }
  const rangeMatch = detail.match(/L(\d+)-L\d+/);
  if (rangeMatch) {
    return parseInt(rangeMatch[1], 10);
  }
  return undefined;
}

function parseSectionRows(
  lines: string[],
  startIndex: number,
  endIndex: number
): [string, string][] {
  const rows: [string, string][] = [];
  let passedHeader = false;

  for (let i = startIndex; i < endIndex; i++) {
    const line = lines[i];
    if (isSeparatorLine(line)) {
      break;
    }
    if (!passedHeader) {
      if (isTableRuleLine(line)) {
        passedHeader = true;
      }
      continue;
    }
    const cols = splitColumns(line);
    if (cols) {
      rows.push(cols);
    }
  }

  return rows;
}

function findSectionIndex(lines: string[], title: string): number {
  return lines.findIndex((line) => line.trim() === title);
}

export function parseAnalyzeReport(text: string): AnalyzeReport {
  const lines = text.split(/\r?\n/);
  const title = lines.find((l) => l.trim().length > 0)?.trim() ?? "Analysis Report";

  const summaryStart = findSectionIndex(lines, SECTION_SUMMARY);
  const warningsStart = findSectionIndex(lines, SECTION_WARNINGS);
  const identifiedStart = findSectionIndex(lines, SECTION_IDENTIFIED);

  const summaryEnd =
    warningsStart >= 0 ? warningsStart : identifiedStart >= 0 ? identifiedStart : lines.length;
  const warningsEnd = identifiedStart >= 0 ? identifiedStart : lines.length;
  const identifiedEnd = lines.length;

  const summaryRows =
    summaryStart >= 0
      ? parseSectionRows(lines, summaryStart + 1, summaryEnd)
      : [];
  const warningRows =
    warningsStart >= 0
      ? parseSectionRows(lines, warningsStart + 1, warningsEnd)
      : [];
  const identifiedRows =
    identifiedStart >= 0
      ? parseSectionRows(lines, identifiedStart + 1, identifiedEnd)
      : [];

  return {
    title,
    summary: summaryRows.map(([element, count]) => ({ element, count })),
    warnings: warningRows.map(([type, message]) => ({ type, message })),
    identified: identifiedRows.map(([kind, detail]) => ({
      kind,
      detail,
      line: parseLineNumber(detail),
    })),
  };
}
