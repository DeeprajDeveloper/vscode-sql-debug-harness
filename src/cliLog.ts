import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function appendStepLogToOutput(
  channel: vscode.OutputChannel,
  logPath: string,
  label: string
): boolean {
  if (!fs.existsSync(logPath)) {
    return false;
  }

  const content = fs.readFileSync(logPath, "utf-8").trim();
  if (!content) {
    return false;
  }

  channel.appendLine("");
  channel.appendLine(`--- Step log (${label}) ---`);
  channel.appendLine(content);
  return true;
}

export function copyLogBesideSource(
  logPath: string,
  sourceUri: vscode.Uri,
  baseName: string,
  channel: vscode.OutputChannel
): string | null {
  if (!fs.existsSync(logPath)) {
    return null;
  }

  const destPath = path.join(path.dirname(sourceUri.fsPath), `${baseName}.log`);
  fs.copyFileSync(logPath, destPath);
  channel.appendLine(`Log file saved: ${destPath}`);
  return destPath;
}

export function stepLogPath(tmpDir: string): string {
  return path.join(tmpDir, "sql-sp-harness.log");
}
