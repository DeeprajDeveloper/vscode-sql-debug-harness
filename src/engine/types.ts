/** Shared types for the in-process T-SQL harness engine. */

export type TraceStyle = "print" | "raiserror";

export type LogCallback = (functionName: string, message: string) => void;

export interface TransformStats {
  dmlStubbed: number;
  execStubbed: number;
  tclNeutralized: number;
  tracesAdded: number;
  warnings: string[];
}

export interface TransformResult {
  sql: string;
  stats: TransformStats;
  parseErrors: string[];
  stepLog: string[];
}

export interface GenerateOptions {
  traceStyle?: TraceStyle;
  stubDml?: boolean;
  addBlockMarkers?: boolean;
  stripComments?: boolean;
  onProgress?: (message: string) => void;
  onLog?: LogCallback;
}

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
  isParsable: boolean;
  summary: AnalyzeSummaryRow[];
  warnings: AnalyzeWarningRow[];
  identified: AnalyzeIdentifiedRow[];
  stepLog: string[];
  /** Plain-text report compatible with the legacy CLI layout. */
  plainText: string;
}

export interface InventoryCounts {
  isParsable: boolean;
  errors: string[];
  warnings: string[];
  insert: number;
  update: number;
  delete: number;
  merge: number;
  ifCount: number;
  whileCount: number;
  setCount: number;
  setVariable: number;
  selectAssign: number;
  tryCatchBlocks: number;
  cursorCount: number;
  dynamicSqlCount: number;
  details: Record<string, string[]>;
}

export interface DmlFinding {
  kind: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface TryCatchFinding {
  index: number;
  tryLine: number;
  endTryLine: number;
  catchLine: number;
  endCatchLine: number;
}

export interface TsqlScanResult {
  insert: number;
  update: number;
  delete: number;
  merge: number;
  tryCatchBlocks: number;
  beginTry: number;
  endTry: number;
  beginCatch: number;
  endCatch: number;
  dmlFindings: DmlFinding[];
  tryCatchFindings: TryCatchFinding[];
  notes: string[];
}
