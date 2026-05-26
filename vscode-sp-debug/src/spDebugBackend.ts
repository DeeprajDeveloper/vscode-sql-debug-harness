import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const PROBE_TIMEOUT_MS = 10_000;

export type SpDebugBackend = {
  pythonPath: string;
  env: NodeJS.ProcessEnv;
  source: "installed" | "workspace";
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

export function workspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return "";
  }
  return folders[0].uri.fsPath;
}

export function workspaceDevSrc(root: string): string | null {
  const src = path.join(root, "tools", "sp-debug", "src");
  return fs.existsSync(path.join(src, "sp_debug", "__init__.py")) ? src : null;
}

export function getSpDebugSettings(): {
  pythonPath: string;
  traceStyle: string;
  preferWorkspaceDev: boolean;
  pipPackage: string;
} {
  const config = vscode.workspace.getConfiguration("spDebug");
  return {
    pythonPath: (config.get<string>("pythonPath", "") ?? "").trim(),
    traceStyle: config.get<string>("traceStyle", "print"),
    preferWorkspaceDev: config.get<boolean>("preferWorkspaceDev", true),
    pipPackage: config.get<string>("pipPackage", "mssql-sp-debug"),
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

function prependPythonPath(src: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged = { ...env };
  const existing = merged.PYTHONPATH ?? "";
  merged.PYTHONPATH = existing ? `${src}${path.delimiter}${existing}` : src;
  return merged;
}

function probePython(
  pythonPath: string,
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const args =
      pythonPath === "py"
        ? ["-3", "-c", "import sp_debug; print(sp_debug.__version__)"]
        : ["-c", "import sp_debug; print(sp_debug.__version__)"];

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
  const { pythonPath, preferWorkspaceDev } = getSpDebugSettings();
  const candidates = pythonCandidates(pythonPath);

  for (const py of candidates) {
    const result = await probePython(py, process.env);
    if (result.ok) {
      return {
        pythonPath: py,
        env: process.env,
        source: "installed",
        version: result.version,
      };
    }
  }

  if (preferWorkspaceDev) {
    const root = workspaceRoot();
    const src = root ? workspaceDevSrc(root) : null;
    if (src) {
      const devEnv = prependPythonPath(src, process.env);
      for (const py of candidates) {
        const result = await probePython(py, devEnv);
        if (result.ok) {
          return {
            pythonPath: py,
            env: devEnv,
            source: "workspace",
            version: result.version,
          };
        }
      }
    }
  }

  const pipPackage = getSpDebugSettings().pipPackage;
  const installCmd = `${candidates[0] ?? "python3"} -m pip install ${pipPackage}`;
  return {
    kind: "setup",
    message: `sp-debug is not available. Install the Python package, then reload the window.\n\n  ${installCmd}`,
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
        ? ["-3", "-m", "sp_debug", ...args]
        : ["-m", "sp_debug", ...args];

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
    "MS-SQL Debug Scripter: Python backend not found.",
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
  const via =
    backend.source === "workspace"
      ? "workspace tools/sp-debug"
      : "pip-installed sp_debug";
  return `${backend.pythonPath} (${via}, v${backend.version})`;
}
