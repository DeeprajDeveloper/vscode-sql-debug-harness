import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  formatBackendLabel,
  getSpDebugSettings,
  isSetupFailure,
  promptSetupFailure,
  resolveSpDebugBackend,
  runSpDebugCli,
  SpDebugBackend,
} from "./spDebugBackend";

const OUTPUT_CHANNEL = "MS-SQL SP Debug";

function getOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel(OUTPUT_CHANNEL);
}

async function requireBackend(): Promise<SpDebugBackend | null> {
  const resolved = await resolveSpDebugBackend();
  if (isSetupFailure(resolved)) {
    getOutputChannel().appendLine(resolved.message);
    await promptSetupFailure(resolved);
    return null;
  }
  return resolved;
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
  const backend = await requireBackend();
  if (!backend) {
    return;
  }

  const resolved = await resolveSqlSource(uri);
  if (!resolved) {
    return;
  }

  const { traceStyle } = getSpDebugSettings();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-debug-"));
  const inputPath = path.join(tmpDir, "input.sql");
  const outputPath = path.join(tmpDir, "output_debug.sql");

  fs.writeFileSync(inputPath, resolved.source, "utf-8");

  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine(`[${resolved.label}] Backend: ${formatBackendLabel(backend)}`);
  channel.appendLine(`Running: ${backend.pythonPath} -m sp_debug transform ...`);

  const { stdout, stderr, code } = await runSpDebugCli(
    backend,
    [
      "transform",
      "-i",
      inputPath,
      "-o",
      outputPath,
      "--trace-style",
      traceStyle,
    ],
    tmpDir
  );

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
  const backend = await requireBackend();
  if (!backend) {
    return;
  }

  const resolved = await resolveSqlSource(uri);
  if (!resolved) {
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-debug-"));
  const inputPath = path.join(tmpDir, "input.sql");

  fs.writeFileSync(inputPath, resolved.source, "utf-8");

  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine(`[${resolved.label}] Backend: ${formatBackendLabel(backend)}`);
  channel.appendLine(`Running: ${backend.pythonPath} -m sp_debug inventory ...`);

  const { stdout, stderr, code } = await runSpDebugCli(
    backend,
    ["inventory", "-i", inputPath],
    tmpDir
  );

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
  await vscode.window.showTextDocument(reportDoc, {
    preview: false,
    viewColumn: vscode.ViewColumn.Beside,
  });

  vscode.window.showInformationMessage(
    `MS-SQL SP Debug: inventory report generated for ${resolved.label}.`
  );
}

async function verifySetup(): Promise<void> {
  const channel = getOutputChannel();
  channel.show(true);
  channel.clear();
  channel.appendLine("MS-SQL Debug Scripter — setup verification");
  channel.appendLine("");

  const settings = getSpDebugSettings();
  channel.appendLine(`spDebug.pythonPath: ${settings.pythonPath || "(auto)"}`);
  channel.appendLine(`spDebug.preferWorkspaceDev: ${settings.preferWorkspaceDev}`);
  channel.appendLine(`spDebug.pipPackage: ${settings.pipPackage}`);
  channel.appendLine(`spDebug.traceStyle: ${settings.traceStyle}`);
  channel.appendLine("");

  const resolved = await resolveSpDebugBackend();
  if (isSetupFailure(resolved)) {
    channel.appendLine("Status: NOT READY");
    channel.appendLine("");
    channel.appendLine(resolved.message);
    channel.appendLine("");
    channel.appendLine("Tried Python: " + resolved.pythonCandidates.join(", "));
    vscode.window.showErrorMessage(
      "MS-SQL Debug Scripter: setup incomplete. See output channel.",
      "Copy pip install"
    ).then((choice) => {
      if (choice === "Copy pip install") {
        const cmd = `${resolved.pythonCandidates[0] ?? "python3"} -m pip install ${resolved.pipPackage}`;
        void vscode.env.clipboard.writeText(cmd);
      }
    });
    return;
  }

  channel.appendLine("Status: OK");
  channel.appendLine(`Backend: ${formatBackendLabel(resolved)}`);
  channel.appendLine("");
  channel.appendLine("You can generate debug scripts from any .sql file in your workspace.");

  vscode.window.showInformationMessage(
    `MS-SQL Debug Scripter ready (${formatBackendLabel(resolved)}).`
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("spDebug.generate", (uri?: vscode.Uri) =>
      generateDebugScript(uri)
    ),
    vscode.commands.registerCommand("spDebug.inventory", (uri?: vscode.Uri) =>
      runInventory(uri)
    ),
    vscode.commands.registerCommand("spDebug.verifySetup", () => verifySetup())
  );
}

export function deactivate(): void {}
