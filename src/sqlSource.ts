import * as vscode from "vscode";

export type SqlSourceContext = {
  source: string;
  baseName: string;
  label: string;
  sourceUri?: vscode.Uri;
};
