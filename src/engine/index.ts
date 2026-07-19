/** Public API for the in-process T-SQL SP harness engine. */

export { generate, transformSql } from "./transform";
export { analyze, inventoryFromSql, inventoryToPlainText } from "./inventory";
export { scanTsql } from "./scan";
export { buildDmlPreview } from "./dmlPreview";
export { detectUnsupported } from "./unsupported";
export type {
  AnalyzeReport,
  AnalyzeIdentifiedRow,
  AnalyzeSummaryRow,
  AnalyzeWarningRow,
  GenerateOptions,
  TraceStyle,
  TransformResult,
  TransformStats,
  InventoryCounts,
} from "./types";
