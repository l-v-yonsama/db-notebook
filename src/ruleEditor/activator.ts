import { StateStorage } from "../utilities/StateStorage";
import { ExtensionContext, Uri, commands, window, workspace } from "vscode";
import * as path from "path";
import { CREATE_NEW_RECORD_RULE } from "../constant";
import { RecordRuleEditorProvider } from "./editorProvider";
import { DbSchema, DbTable } from "@l-v-yonsama/multi-platform-database-drivers";
import { RecordRule } from "../shared/RecordRule";
import { writeToResource } from "../utilities/fsUtil";

export function activateRuleEditor(context: ExtensionContext, stateStorage: StateStorage) {
  context.subscriptions.push(RecordRuleEditorProvider.register(context, stateStorage));

  // Commands
  context.subscriptions.push(
    commands.registerCommand(CREATE_NEW_RECORD_RULE, async (tableRes: DbTable) => {
      try {
        const fileFilters = {
          "Record Rule": ["rrule"],
        };
        let wsfolder = workspace.workspaceFolders?.[0].uri?.fsPath ?? "";

        const uri = await window.showSaveDialog({
          defaultUri: Uri.file(path.join(wsfolder, `${tableRes.name}.rrule`)),
          filters: fileFilters,
          title: "Save Record Rule file",
        });

        if (!uri) {
          return;
        }
        const { conName, schemaName } = tableRes.meta;
        const recordRule: RecordRule = {
          connectionName: conName,
          schemaName,
          tableRule: {
            table: tableRes.name,
            details: [],
          },
        };
        await writeToResource(uri, JSON.stringify(recordRule, null, 1));
        window.showInformationMessage(`Successfully saved, please open it.\n${uri.fsPath}`);
      } catch (e: any) {
        window.showErrorMessage(e.message);
      }
    })
  );
}
