import { commands, ExtensionContext } from "vscode";
import { CLEAR_TOOL_ACTIVITY_HISTORY, SHOW_INVOCATION_LOG } from "../../constant";
import { log, show } from "../../utilities/logger";
import type { ToolActivityCategoryElement } from "./ToolActivityTreeProvider";
import { clearHistory, ToolInvocationRecord } from "./ToolInvocationTracker";

const PREFIX = "[toolActivity/ToolActivityTreeCommand]";

export function registerToolActivityTreeCommand(context: ExtensionContext): void {
  context.subscriptions.push(
    commands.registerCommand(SHOW_INVOCATION_LOG, (record?: ToolInvocationRecord) => {
      if (!record) {
        return;
      }
      const texts: string[] = [];
      texts.push(`tool:[${record.toolName}] source:[${record.source}] status:[${record.status}]`);
      texts.push(`input:[${record.inputSummary}]`);
      texts.push(`output:[${record.outputSummary}]`);
      log(`${PREFIX} ${texts.join("\n")}`);
      show(true);
    })
  );

  // Bulk clear only -- no per-item clear (see the tree view plan's "見送る案").
  context.subscriptions.push(
    commands.registerCommand(CLEAR_TOOL_ACTIVITY_HISTORY, (element?: ToolActivityCategoryElement) => {
      if (!element) {
        return;
      }
      clearHistory(element.source);
    })
  );
}
