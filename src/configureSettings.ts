import * as vscode from "vscode";
import { getSpDebugSettings } from "./spDebugBackend";

const CONFIG_SECTION = "spDebug";
const SETTINGS_FILTER = "@ext:deeprajadhikary.sql-sp-harness";

type SettingKind = "string" | "boolean" | "enum";

type SettingDef = {
  key: string;
  label: string;
  detail: string;
  kind: SettingKind;
  enumValues?: string[];
  isDivider?: boolean;
};

const SETTING_DEFS: SettingDef[] = [
  {
    key: "__open_settings__",
    label: "Open SQL SP Harness in Settings UI",
    detail: "Browse all options in the Settings editor",
    kind: "string",
  },
  {
    key: "__divider_backend__",
    label: "— Backend —",
    detail: "",
    kind: "string",
    isDivider: true,
  },
  {
    key: "pythonPath",
    label: "Python executable",
    detail: "Path to python3, python, or py. Empty = auto-detect.",
    kind: "string",
  },
  {
    key: "pipPackage",
    label: "PyPI package name",
    detail: "Package installed on startup (default: sql-sp-harness)",
    kind: "string",
  },
  {
    key: "autoInstallBackend",
    label: "Auto-install backend on activation",
    detail: "Run pip install when Python is found but package is missing",
    kind: "boolean",
  },
  {
    key: "__divider_generate__",
    label: "— Generate —",
    detail: "",
    kind: "string",
    isDivider: true,
  },
  {
    key: "traceStyle",
    label: "Trace style",
    detail: "PRINT or RAISERROR for variable traces in debug scripts",
    kind: "enum",
    enumValues: ["print", "raiserror"],
  },
  {
    key: "__divider_logging__",
    label: "— Logging —",
    detail: "",
    kind: "string",
    isDivider: true,
  },
  {
    key: "logToOutput",
    label: "Show step log in Output channel",
    detail: "Print --log-file audit trail after analyze/generate",
    kind: "boolean",
  },
  {
    key: "saveLogFile",
    label: "Save step log beside .sql file",
    detail: "Write <procedure>.log next to the source file",
    kind: "boolean",
  },
  {
    key: "quietWhenLogging",
    label: "Quiet stderr when logging (generate)",
    detail: "Avoid duplicating progress on stderr when log is enabled",
    kind: "boolean",
  },
];

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function currentValue(key: string): string | boolean | undefined {
  if (key.startsWith("__")) {
    return undefined;
  }
  return config().get(key);
}

function formatCurrentValue(key: string, kind: SettingKind): string {
  const value = currentValue(key);
  if (kind === "boolean") {
    return value === true ? "on" : value === false ? "off" : "(default)";
  }
  if (value === undefined || value === "") {
    return kind === "string" ? "(empty / auto)" : "(default)";
  }
  return String(value);
}

export async function openExtensionSettings(): Promise<void> {
  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    SETTINGS_FILTER
  );
}

async function promptString(key: string, label: string): Promise<void> {
  const current = config().get<string>(key, "");
  const value = await vscode.window.showInputBox({
    title: `SQL SP Harness: ${label}`,
    value: current,
    placeHolder: key === "pythonPath" ? "e.g. /usr/bin/python3 or leave empty" : undefined,
    prompt: "Leave empty to use the default.",
  });
  if (value === undefined) {
    return;
  }
  await config().update(key, value.trim(), vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    `SQL SP Harness: ${label} updated.`
  );
}

async function promptBoolean(key: string, label: string): Promise<void> {
  const current = config().get<boolean>(key);
  const choice = await vscode.window.showQuickPick(
    [
      { label: "On", value: true, description: "Enable" },
      { label: "Off", value: false, description: "Disable" },
    ],
    {
      title: `SQL SP Harness: ${label}`,
      placeHolder: `Current: ${current === true ? "on" : current === false ? "off" : "default"}`,
    }
  );
  if (!choice) {
    return;
  }
  await config().update(key, choice.value, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    `SQL SP Harness: ${label} set to ${choice.label.toLowerCase()}.`
  );
}

async function promptEnum(
  key: string,
  label: string,
  enumValues: string[]
): Promise<void> {
  const current = config().get<string>(key, enumValues[0]);
  const choice = await vscode.window.showQuickPick(
    enumValues.map((v) => ({
      label: v,
      picked: v === current,
    })),
    {
      title: `SQL SP Harness: ${label}`,
      placeHolder: `Current: ${current}`,
    }
  );
  if (!choice) {
    return;
  }
  await config().update(key, choice.label, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    `SQL SP Harness: ${label} set to ${choice.label}.`
  );
}

async function configureSingleSetting(def: SettingDef): Promise<void> {
  if (def.key === "__open_settings__") {
    await openExtensionSettings();
    return;
  }

  switch (def.kind) {
    case "string":
      await promptString(def.key, def.label);
      break;
    case "boolean":
      await promptBoolean(def.key, def.label);
      break;
    case "enum":
      await promptEnum(def.key, def.label, def.enumValues ?? []);
      break;
  }
}

export async function configureSettingsInteractive(): Promise<void> {
  // Surface current values in the palette (also confirms settings are registered).
  getSpDebugSettings();

  while (true) {
    const items = SETTING_DEFS.map((def) => {
      if (def.isDivider) {
        return {
          label: def.label,
          kind: vscode.QuickPickItemKind.Separator,
        } as vscode.QuickPickItem;
      }

      const suffix =
        def.key === "__open_settings__"
          ? ""
          : ` — ${formatCurrentValue(def.key, def.kind)}`;

      return {
        label: `${def.label}${suffix}`,
        description: def.detail,
        def,
      };
    });

    const choice = await vscode.window.showQuickPick(items, {
      title: "SQL SP Harness: Configure Settings",
      placeHolder: "Choose a setting to change, or Esc to close",
      matchOnDescription: true,
    });

    if (!choice || !("def" in choice)) {
      return;
    }

    await configureSingleSetting(choice.def as SettingDef);
  }
}
