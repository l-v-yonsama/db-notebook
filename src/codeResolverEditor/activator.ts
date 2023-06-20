import { StateStorage } from "../utilities/StateStorage";
import { ExtensionContext, Uri, commands, window, workspace } from "vscode";
import * as path from "path";
import { CODE_RESOLVER_TYPE, CREATE_CODE_RESOLVER } from "../constant";
import { CodeResolver } from "../shared/CodeResolver";
import { CodeResolverEditorProvider } from "./editorProvider";
import { writeToResource } from "../utilities/fsUtil";

export function activateCodeResolverEditor(context: ExtensionContext, stateStorage: StateStorage) {
  context.subscriptions.push(CodeResolverEditorProvider.register(context, stateStorage));

  // Commands
  context.subscriptions.push(
    commands.registerCommand(CREATE_CODE_RESOLVER, async () => {
      try {
        const fileFilters = {
          "Code label resolver": ["cresolver"],
        };
        let wsfolder = workspace.workspaceFolders?.[0].uri?.fsPath ?? "";

        const uri = await window.showSaveDialog({
          defaultUri: Uri.file(path.join(wsfolder, "new-code-resolver.cresolver")),
          filters: fileFilters,
          title: "Save Code label resolver file",
        });

        if (!uri) {
          return;
        }

        const resolver: CodeResolver = {
          connectionName: "",
          items: [],
        };
        await writeToResource(uri, JSON.stringify(resolver, null, 1));
        // window.showInformationMessage(`Successfully saved, please open it.\n${uri.fsPath}`);

        commands.executeCommand("vscode.openWith", uri, CODE_RESOLVER_TYPE);
      } catch (e: any) {
        window.showErrorMessage(e.message);
      }
    })
  );
}
