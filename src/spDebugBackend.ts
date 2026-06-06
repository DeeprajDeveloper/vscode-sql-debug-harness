import * as child_process from "child_process";
import * as vscode from "vscode";

const PROBE_TIMEOUT_MS = 10_000;
const MODULE_NAME = "sql_sp_harness";

export type SpDebugBackend = {
  pythonPath: string;
  env: NodeJS.ProcessEnv;
  version: string;
};

export type SpDebugSetupFailure = {
  kind: "setup";
  message: string;
  pipPackage: string;
  pythonCandidates: string[];
};

export function isSetupFailure(
  resolved: SpDebugBackend | SpDebugSetupFailure
): resolved is SpDebugSetupFailure {
  return "kind" in resolved && resolved.kind === "setup";
}

export function getSpDebugSettings(): {
  pythonPath: string;
  traceStyle: string;
  pipPackage: string;
  logToOutput: boolean;
  saveLogFile: boolean;
  quietWhenLogging: boolean;
} {
  const config = vscode.workspace.getConfiguration("spDebug");
  return {
    pythonPath: (config.get<string>("pythonPath", "") ?? "").trim(),
    traceStyle: config.get<string>("traceStyle", "print"),
    pipPackage: config.get<string>("pipPackage", "sql-sp-harness"),
    logToOutput: config.get<boolean>("logToOutput", true),
    saveLogFile: config.get<boolean>("saveLogFile", false),
    quietWhenLogging: config.get<boolean>("quietWhenLogging", true),
  };
}

/** Python executables to try when spDebug.pythonPath is empty. */
export function defaultPythonCandidates(): string[] {
  if (process.platform === "win32") {
    return ["python", "python3", "py"];
  }
  return ["python3", "python"];
}

export function pythonCandidates(configuredPath: string): string[] {
  if (configuredPath) {
    return [configuredPath];
  }
  const seen = new Set<string>();
  const list: string[] = [];
  for (const c of defaultPythonCandidates()) {
    if (!seen.has(c)) {
      seen.add(c);
      list.push(c);
    }
  }
  return list;
}

function probePython(
  pythonPath: string,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const importScript = `import ${MODULE_NAME}; print(${MODULE_NAME}.__version__)`;
    const args =
      pythonPath === "py"
        ? ["-3", "-c", importScript]
        : ["-c", importScript];

    const proc = child_process.spawn(pythonPath, args, { env, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ ok: false, error: "timed out" });
    }, PROBE_TIMEOUT_MS);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, version: stdout.trim() });
      } else {
        const detail = (stderr || stdout).trim();
        resolve({
          ok: false,
          error: detail || `exit ${code ?? "unknown"}`,
        });
      }
    });
  });
}

export async function resolveSpDebugBackend(): Promise<
  SpDebugBackend | SpDebugSetupFailure
> {
  const { pythonPath } = getSpDebugSettings();
  const candidates = pythonCandidates(pythonPath);

  for (const py of candidates) {
    const result = await probePython(py, process.env);
    if (result.ok) {
      return {
        pythonPath: py,
        env: process.env,
        version: result.version,
      };
    }
  }

  const pipPackage = getSpDebugSettings().pipPackage;
  const installCmd = `${candidates[0] ?? "python3"} -m pip install ${pipPackage}`;
  return {
    kind: "setup",
    message: `sql-sp-harness is not available. Install the Python package, then reload the window.\n\n  ${installCmd}`,
    pipPackage,
    pythonCandidates: candidates,
  };
}

export function runSpDebugCli(
  backend: SpDebugBackend,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const spawnArgs =
      backend.pythonPath === "py"
        ? ["-3", "-m", MODULE_NAME, ...args]
        : ["-m", MODULE_NAME, ...args];

    const proc = child_process.spawn(backend.pythonPath, spawnArgs, {
      env: backend.env,
      cwd: cwd || undefined,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

export async function promptSetupFailure(
  failure: SpDebugSetupFailure
): Promise<SpDebugBackend | null> {
  const pipCmd = `${failure.pythonCandidates[0] ?? "python3"} -m pip install ${failure.pipPackage}`;
  const choice = await vscode.window.showErrorMessage(
    "SQL SP Harness: Python backend not found.",
    "Copy pip install",
    "Open Settings",
    "Verify setup"
  );
  if (choice === "Copy pip install") {
    await vscode.env.clipboard.writeText(pipCmd);
    vscode.window.showInformationMessage(`Copied: ${pipCmd}`);
  } else if (choice === "Open Settings") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "spDebug"
    );
  } else if (choice === "Verify setup") {
    await vscode.commands.executeCommand("spDebug.verifySetup");
  }
  return null;
}

export function formatBackendLabel(backend: SpDebugBackend): string {
  return `${backend.pythonPath} (sql-sp-harness v${backend.version})`;
}
