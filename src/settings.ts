import * as vscode from "vscode";
import type { TraceStyle } from "./engine";

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
  const traceStyle = cfg.get<string>("traceStyle", "print");
  const toolbarStyle = cfg.get<string>("workbenchToolbarStyle", "iconsAndText");
  const workbenchToolbarStyle: WorkbenchToolbarStyle =
    toolbarStyle === "iconsOnly" || toolbarStyle === "textOnly"
      ? toolbarStyle
      : "iconsAndText";
  return {
    traceStyle: traceStyle === "raiserror" ? "raiserror" : "print",
    logToOutput: cfg.get<boolean>("logToOutput", true),
    saveLogFile: cfg.get<boolean>("saveLogFile", false),
    quietWhenLogging: cfg.get<boolean>("quietWhenLogging", true),
    workbenchToolbarStyle,
  };
}
