import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const OUTPUT_CHANNEL = "MS-SQL SP Debug";

function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return "";
  }
  return folders[0].uri.fsPath;
}

function spDebugModulePath(root: string): string {
  return path.join(root, "tools", "sp-debug");
}

function getConfig(): { pythonPath: string; traceStyle: string } {
  const config = vscode.workspace.getConfiguration("spDebug");
  return {
    pythonPath: config.get<string>("pythonPath", "python3"),
    traceStyle: config.get<string>("traceStyle", "print"),
  };
}

function ensureSpDebugAvailable(): string | null {
  const root = workspaceRoot();
  if (!root || !fs.existsSync(spDebugModulePath(root))) {
    return "MS-SQL SP Debug: tools/sp-debug not found in workspace root.";
  }
  return null;
}

function runSpDebugCli(
  pythonPath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const root = workspaceRoot();
    const env = { ...process.env };
    if (root) {
      const src = path.join(spDebugModulePath(root), "src");
      env.PYTHONPATH = src + (env.PYTHONPATH ? path.delimiter + env.PYTHONPATH : "");
    }
    const proc = child_process.spawn(
      pythonPath,
      ["-m", "sp_debug", ...args],
      { env, cwd: root || undefined }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

async function resolveSqlSource(
  uri?: vscode.Uri
): Promise<{ source: string; baseName: string; label: string } | null> {
  if (uri) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (path.extname(uri.fsPath).toLowerCase() !== ".sql") {
      vscode.window.showWarningMessage("MS-SQL SP Debug: file is not a .sql file.");
      return null;
    }
    const baseName = path.basename(uri.fsPath, path.extname(uri.fsPath));
    return { source: doc.getText(), baseName, label: path.basename(uri.fsPath) };
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("MS-SQL SP Debug: open a .sql file first.");
    return null;
  }
  if (editor.document.languageId !== "sql") {
    vscode.window.showWarningMessage("MS-SQL SP Debug: active file is not SQL.");
    return null;
  }

  const doc = editor.document;
  const selection = editor.selection;
  const source = selection.isEmpty ? doc.getText() : doc.getText(selection);
  const filePath = doc.uri.fsPath;
  const baseName = filePath
    ? path.basename(filePath, path.extname(filePath))
    : "script";
  const label = filePath ? path.basename(filePath) : "untitled.sql";
  return { source, baseName, label };
}

async function generateDebugScript(uri?: vscode.Uri): Promise<void> {
  const setupError = ensureSpDebugAvailable();
  if (setupError) {
    vscode.window.showErrorMessage(setupError);
    return;
  }

  const resolved = await resolveSqlSource(uri);
  if (!resolved) {
    return;
  }

  const { pythonPath, traceStyle } = getConfig();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-debug-"));
  const inputPath = path.join(tmpDir, "input.sql");
  const outputPath = path.join(tmpDir, "output_debug.sql");

  fs.writeFileSync(inputPath, resolved.source, "utf-8");

  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  channel.show(true);
  channel.appendLine(`[${resolved.label}] Running: ${pythonPath} -m sp_debug transform ...`);

  const { stdout, stderr, code } = await runSpDebugCli(pythonPath, [
    "transform",
    "-i",
    inputPath,
    "-o",
    outputPath,
    "--trace-style",
    traceStyle,
  ]);

  if (stdout) {
    channel.appendLine(stdout.trim());
  }
  if (stderr) {
    channel.appendLine(stderr.trim());
  }

  if (code !== 0 && code !== 2) {
    vscode.window.showErrorMessage(
      `MS-SQL SP Debug failed (exit ${code}). See ${OUTPUT_CHANNEL} output.`
    );
    return;
  }

  if (!fs.existsSync(outputPath)) {
    vscode.window.showErrorMessage("MS-SQL SP Debug: no output file produced.");
    return;
  }

  const outText = fs.readFileSync(outputPath, "utf-8");
  const outDoc = await vscode.workspace.openTextDocument({
    content: outText,
    language: "sql",
  });
  await vscode.window.showTextDocument(outDoc, { preview: false });
  channel.appendLine(`Opened debug script (${resolved.baseName}_debug).`);

  if (code === 2) {
    vscode.window.showWarningMessage(
      "MS-SQL SP Debug: completed with warnings — review banner in output."
    );
  } else {
    vscode.window.showInformationMessage(
      `MS-SQL SP Debug: debug script generated for ${resolved.label}.`
    );
  }
}

async function runInventory(uri?: vscode.Uri): Promise<void> {
  const setupError = ensureSpDebugAvailable();
  if (setupError) {
    vscode.window.showErrorMessage(setupError);
    return;
  }

  const resolved = await resolveSqlSource(uri);
  if (!resolved) {
    return;
  }

  const { pythonPath } = getConfig();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-debug-"));
  const inputPath = path.join(tmpDir, "input.sql");

  fs.writeFileSync(inputPath, resolved.source, "utf-8");

  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  channel.show(true);
  channel.appendLine(`[${resolved.label}] Running: ${pythonPath} -m sp_debug inventory ...`);

  const { stdout, stderr, code } = await runSpDebugCli(pythonPath, [
    "inventory",
    "-i",
    inputPath,
  ]);

  if (stderr) {
    channel.appendLine(stderr.trim());
  }

  if (code !== 0) {
    if (stdout) {
      channel.appendLine(stdout.trim());
    }
    vscode.window.showErrorMessage(
      `MS-SQL SP Debug inventory failed (exit ${code}). See ${OUTPUT_CHANNEL} output.`
    );
    return;
  }

  const report = stdout.trim();
  channel.appendLine(report);

  const reportDoc = await vscode.workspace.openTextDocument({
    content: report + "\n",
    language: "plaintext",
  });
  await vscode.window.showTextDocument(reportDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

  vscode.window.showInformationMessage(
    `MS-SQL SP Debug: inventory report generated for ${resolved.label}.`
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("spDebug.generate", (uri?: vscode.Uri) =>
      generateDebugScript(uri)
    ),
    vscode.commands.registerCommand("spDebug.inventory", (uri?: vscode.Uri) =>
      runInventory(uri)
    )
  );
}

export function deactivate(): void {}
