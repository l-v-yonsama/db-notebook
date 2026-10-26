import { commands, ExtensionContext, window } from "vscode";
import {
  DELETE_ALL_RPC_HISTORY,
  DELETE_RPC_HISTORY,
  REFRESH_RPC_HISTORIES,
} from "../../constant";
import { RpcInvokeHistory } from "../../types/RpcInvokeHistory";
import { RpcInvokeHistoryStore } from "../../utilities/RpcInvokeHistoryStore";
import { RpcHistoryTreeProvider } from "./RpcHistoryTreeProvider";

export const registerRpcHistoryTreeCommands = (
  context: ExtensionContext,
  store: RpcInvokeHistoryStore,
  provider: RpcHistoryTreeProvider
): void => {
  context.subscriptions.push(
    commands.registerCommand(REFRESH_RPC_HISTORIES, () => provider.refresh()),
    commands.registerCommand(DELETE_RPC_HISTORY, async (history: RpcInvokeHistory) => {
      if (await window.showWarningMessage(
        `Delete RPC history for ${history.path}?`, { modal: true }, "Delete"
      ) === "Delete") {
        await store.delete(history.id);
      }
    }),
    commands.registerCommand(DELETE_ALL_RPC_HISTORY, async () => {
      if (await window.showWarningMessage(
        "Delete all RPC histories?", { modal: true }, "Delete all"
      ) === "Delete all") {
        await store.clear();
      }
    })
  );
};
