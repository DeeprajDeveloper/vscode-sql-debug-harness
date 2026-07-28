import * as vscode from "vscode";
import type { TraceStyle } from "./engine";

const TRACE_STYLES: TraceStyle[] = [
  "select",
  "print",
  "printCombined",
  "raiserror",
];

export type WorkbenchToolbarStyle = "iconsAndText" | "iconsOnly" | "textOnly";

export interface SpDebugSettings {
  traceStyle: TraceStyle;
  logToOutput: boolean;
  saveLogFile: boolean;
  quietWhenLogging: boolean;
  workbenchToolbarStyle: WorkbenchToolbarStyle;
}

export function getSpDebugSettings(): SpDebugSettings {
  const cfg = vscode.workspace.getConfiguration("spDebug");
  const rawTrace = cfg.get<string>("traceStyle", "select");
  const traceStyle: TraceStyle = TRACE_STYLES.includes(rawTrace as TraceStyle)
    ? (rawTrace as TraceStyle)
    : "select";
  const toolbarStyle = cfg.get<string>("workbenchToolbarStyle", "iconsAndText");
  const workbenchToolbarStyle: WorkbenchToolbarStyle =
    toolbarStyle === "iconsOnly" || toolbarStyle === "textOnly"
      ? toolbarStyle
      : "iconsAndText";
  return {
    traceStyle,
    logToOutput: cfg.get<boolean>("logToOutput", true),
    saveLogFile: cfg.get<boolean>("saveLogFile", false),
    quietWhenLogging: cfg.get<boolean>("quietWhenLogging", true),
    workbenchToolbarStyle,
  };
}
