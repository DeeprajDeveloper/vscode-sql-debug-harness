import * as vscode from "vscode";
import type { TraceStyle } from "./engine";

export interface SpDebugSettings {
  traceStyle: TraceStyle;
  logToOutput: boolean;
  saveLogFile: boolean;
  quietWhenLogging: boolean;
}

export function getSpDebugSettings(): SpDebugSettings {
  const cfg = vscode.workspace.getConfiguration("spDebug");
  const traceStyle = cfg.get<string>("traceStyle", "print");
  return {
    traceStyle: traceStyle === "raiserror" ? "raiserror" : "print",
    logToOutput: cfg.get<boolean>("logToOutput", true),
    saveLogFile: cfg.get<boolean>("saveLogFile", false),
    quietWhenLogging: cfg.get<boolean>("quietWhenLogging", true),
  };
}
