import * as child_process from "child_process";
import * as vscode from "vscode";
import {
  formatBackendLabel,
  getSpDebugSettings,
  isSetupFailure,
  resolveSpDebugBackend,
  SpDebugBackend,
  SpDebugSetupFailure,
} from "./spDebugBackend";

const PIP_TIMEOUT_MS = 120_000;

export type BackendSetupState =
  | "checking"
  | "installing"
  | "ready"
  | "python-missing"
  | "install-failed";

export class BackendStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "spDebug.verifySetup";
    context.subscriptions.push(this.item);
    this.setChecking();
    this.item.show();
  }

  setChecking(): void {
    this.item.text = "$(sync~spin) SQL SP Harness: Checking…";
    this.item.tooltip = "Checking Python backend — click for details";
    this.item.backgroundColor = undefined;
  }

  setInstalling(pythonPath: string, pipPackage: string): void {
    this.item.text = "$(cloud-download) SQL SP Harness: Installing backend…";
    this.item.tooltip = `Installing ${pipPackage} with ${pythonPath}`;
    this.item.backgroundColor = undefined;
  }

  setReady(backend: SpDebugBackend): void {
    this.item.text = "$(check) SQL SP Harness: Ready";
    this.item.tooltip = `Backend: ${formatBackendLabel(backend)}\nClick for setup details`;
    this.item.backgroundColor = undefined;
  }

  setPythonMissing(candidates: string[]): void {
    this.item.text = "$(error) SQL SP Harness: Python not found";
    this.item.tooltip =
      `Python 3.10+ is required.\nTried: ${candidates.join(", ")}\nClick for setup details`;
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  }

  setInstallFailed(message: string): void {
    this.item.text = "$(warning) SQL SP Harness: Setup required";
    this.item.tooltip = `${message}\nClick for setup details`;
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  }
}

function probePythonRuntime(
  pythonPath: string
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const args =
      pythonPath === "py"
        ? ["-3", "--version"]
        : ["--version"];

    const proc = child_process.spawn(pythonPath, args, { shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ ok: false, error: "timed out" });
    }, 10_000);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, version: (stdout || stderr).trim() });
      } else {
        resolve({
          ok: false,
          error: (stderr || stdout).trim() || `exit ${code ?? "unknown"}`,
        });
      }
    });
  });
}

async function findWorkingPython(
  candidates: string[]
): Promise<{ pythonPath: string; version: string } | null> {
  for (const py of candidates) {
    const result = await probePythonRuntime(py);
    if (result.ok) {
      return { pythonPath: py, version: result.version };
    }
  }
  return null;
}

function runPipInstall(
  pythonPath: string,
  pipPackage: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const args =
      pythonPath === "py"
        ? ["-3", "-m", "pip", "install", pipPackage]
        : ["-m", "pip", "install", pipPackage];

    const proc = child_process.spawn(pythonPath, args, { shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr: `${stderr}\n(timed out after ${PIP_TIMEOUT_MS}ms)`, code: 1 });
    }, PIP_TIMEOUT_MS);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: 1 });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function logSetupFailure(
  log: (line: string) => void,
  failure: SpDebugSetupFailure
): void {
  log("");
  log(failure.message);
  log("");
  log(`Tried Python: ${failure.pythonCandidates.join(", ")}`);
}

export async function runStartupBackendSetup(
  context: vscode.ExtensionContext,
  statusBar: BackendStatusBar,
  log: (line: string) => void
): Promise<void> {
  const settings = getSpDebugSettings();
  const autoInstall = vscode.workspace
    .getConfiguration("spDebug")
    .get<boolean>("autoInstallBackend", true);

  log("SQL SP Harness — startup backend check");
  log(`Auto-install backend: ${autoInstall}`);
  log(`spDebug.pythonPath: ${settings.pythonPath || "(auto)"}`);
  log(`spDebug.pipPackage: ${settings.pipPackage}`);
  log("");

  statusBar.setChecking();

  let resolved = await resolveSpDebugBackend();
  if (!isSetupFailure(resolved)) {
    statusBar.setReady(resolved);
    log("Status: READY");
    log(`Backend: ${formatBackendLabel(resolved)}`);
    return;
  }

  const failure = resolved;
  const runtime = await findWorkingPython(failure.pythonCandidates);

  if (!runtime) {
    statusBar.setPythonMissing(failure.pythonCandidates);
    log("Status: PYTHON NOT FOUND");
    logSetupFailure(log, failure);
    log("");
    log("Install Python 3.10+ and reload the window, or set spDebug.pythonPath.");
    await maybeShowFirstRunNotice(context, "python-missing");
    return;
  }

  log(`Python found: ${runtime.pythonPath} (${runtime.version})`);
  log(`Package missing: ${settings.pipPackage}`);

  if (!autoInstall) {
    statusBar.setInstallFailed(
      `${settings.pipPackage} is not installed. Enable spDebug.autoInstallBackend or run pip install manually.`
    );
    log("Status: PACKAGE MISSING (auto-install disabled)");
    logSetupFailure(log, failure);
    return;
  }

  statusBar.setInstalling(runtime.pythonPath, settings.pipPackage);
  log("");
  log(`Installing: ${runtime.pythonPath} -m pip install ${settings.pipPackage}`);

  const installCmd = `${runtime.pythonPath} -m pip install ${settings.pipPackage}`;
  const { stdout, stderr, code } = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "SQL SP Harness",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Installing ${settings.pipPackage}…` });
      return runPipInstall(runtime.pythonPath, settings.pipPackage);
    }
  );

  if (stdout.trim()) {
    log(stdout.trim());
  }
  if (stderr.trim()) {
    log(stderr.trim());
  }

  if (code !== 0) {
    statusBar.setInstallFailed(`pip install failed (exit ${code})`);
    log("");
    log(`Status: INSTALL FAILED (exit ${code})`);
    log(`Try manually: ${installCmd}`);
    await maybeShowFirstRunNotice(context, "install-failed");
    return;
  }

  log("");
  log("Install finished. Verifying backend…");
  resolved = await resolveSpDebugBackend();

  if (!isSetupFailure(resolved)) {
    statusBar.setReady(resolved);
    log("Status: READY");
    log(`Backend: ${formatBackendLabel(resolved)}`);
    await maybeShowFirstRunNotice(context, "ready");
    return;
  }

  statusBar.setInstallFailed("Backend still unavailable after pip install");
  log("Status: VERIFY FAILED");
  logSetupFailure(log, resolved);
  await maybeShowFirstRunNotice(context, "install-failed");
}

async function maybeShowFirstRunNotice(
  context: vscode.ExtensionContext,
  outcome: BackendSetupState
): Promise<void> {
  const key = "sqlSpHarness.startupNoticeShown";
  if (context.globalState.get<boolean>(key)) {
    return;
  }
  await context.globalState.update(key, true);

  if (outcome === "ready") {
    vscode.window.showInformationMessage(
      "SQL SP Harness: backend installed and ready."
    );
  } else if (outcome === "python-missing") {
    vscode.window.showWarningMessage(
      "SQL SP Harness: Python 3.10+ not found. Install Python or set spDebug.pythonPath.",
      "Open Setup Details"
    ).then((choice) => {
      if (choice === "Open Setup Details") {
        void vscode.commands.executeCommand("spDebug.verifySetup");
      }
    });
  } else if (outcome === "install-failed") {
    vscode.window.showWarningMessage(
      "SQL SP Harness: automatic backend install failed. See the SQL SP Harness output channel.",
      "Open Setup Details"
    ).then((choice) => {
      if (choice === "Open Setup Details") {
        void vscode.commands.executeCommand("spDebug.verifySetup");
      }
    });
  }
}

export async function refreshBackendStatus(
  statusBar: BackendStatusBar,
  log?: (line: string) => void
): Promise<void> {
  statusBar.setChecking();
  const resolved = await resolveSpDebugBackend();
  if (!isSetupFailure(resolved)) {
    statusBar.setReady(resolved);
    return;
  }

  const runtime = await findWorkingPython(resolved.pythonCandidates);
  if (!runtime) {
    statusBar.setPythonMissing(resolved.pythonCandidates);
  } else {
    statusBar.setInstallFailed(resolved.message.split("\n")[0]);
  }

  if (log) {
    logSetupFailure(log, resolved);
  }
}
