import * as vscode from "vscode";
import { getSpDebugSettings } from "./settings";

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
    detail: "Print transform/analyze audit trail after analyze/generate",
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
    label: "Quiet progress when logging (generate)",
    detail: "Avoid duplicating progress lines when step log is enabled",
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
    case "boolean":
      await promptBoolean(def.key, def.label);
      break;
    case "enum":
      await promptEnum(def.key, def.label, def.enumValues ?? []);
      break;
  }
}

export async function configureSettingsInteractive(): Promise<void> {
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
