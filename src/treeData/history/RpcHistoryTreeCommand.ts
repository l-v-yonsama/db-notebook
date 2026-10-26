import {
  DBType, DbConnection, DbResource, RpcMethod,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { commands, ExtensionContext, window } from "vscode";
import {
  DELETE_ALL_RPC_HISTORY,
  DELETE_RPC_HISTORY,
  LOAD_DB_SCHEMA,
  OPEN_RPC_HISTORY_IN_INVOKE_PANEL,
  REFRESH_RPC_HISTORIES,
} from "../../constant";
import { RpcInvokePanel } from "../../panels/RpcInvokePanel";
import { ResourceTreeProvider } from "../resource/ResourceTreeProvider";
import { RpcInvokeHistory } from "../../types/RpcInvokeHistory";
import { isRestorableRpcHistory, RpcInvokeHistoryStore } from "../../utilities/RpcInvokeHistoryStore";
import { StateStorage } from "../../utilities/StateStorage";
import { RpcHistoryTreeProvider } from "./RpcHistoryTreeProvider";

const findLoadedMethod = async (
  history: RpcInvokeHistory,
  connection: DbConnection,
  tree: ResourceTreeProvider
): Promise<RpcMethod | undefined> => {
  const visit = async (parent: DbResource): Promise<RpcMethod | undefined> => {
    const children = await tree.getChildren(parent);
    for (const child of children ?? []) {
      if (child instanceof RpcMethod) {
        const current = tree.getLoadedRpcMethodContext(child);
        if (
          current?.connection === connection &&
          current.service.fullName === history.service &&
          child.name === history.method &&
          child.path === history.path &&
          child.requestStream === false &&
          child.responseStream === (history.callKind === "serverStreaming")
        ) {
          return child;
        }
      } else {
        const found = await visit(child);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  return visit(connection);
};

export const registerRpcHistoryTreeCommands = (
  context: ExtensionContext,
  store: RpcInvokeHistoryStore,
  provider: RpcHistoryTreeProvider,
  stateStorage: StateStorage,
  tree: ResourceTreeProvider
): void => {
  context.subscriptions.push(
    commands.registerCommand(REFRESH_RPC_HISTORIES, () => provider.refresh()),
    commands.registerCommand(OPEN_RPC_HISTORY_IN_INVOKE_PANEL, async (selected: RpcInvokeHistory) => {
      const history = (await store.list()).find((item) => item.id === selected?.id);
      if (!history || !isRestorableRpcHistory(history)) {
        return;
      }
      const roots = await tree.getChildren();
      const connection = roots?.find((root): root is DbConnection =>
        root instanceof DbConnection &&
        root.name === history.connectionName &&
        root.dbType === DBType.RPC
      );
      if (!connection) {
        await window.showInformationMessage("The RPC connection for this history no longer exists.");
        return;
      }
      if (!stateStorage.getResourceByName(connection.name)?.length) {
        await commands.executeCommand(LOAD_DB_SCHEMA, connection);
      }
      const method = await findLoadedMethod(history, connection, tree);
      if (!method) {
        await window.showInformationMessage("This RPC method is no longer available in the current schema.");
        return;
      }
      const current = tree.getLoadedRpcMethodContext(method)!;
      RpcInvokePanel.render(
        context.extensionUri,
        stateStorage,
        tree,
        method,
        current.service,
        connection.name,
        history.requestJson
      );
    }),
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
