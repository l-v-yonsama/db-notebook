import {
  DBType, DbConnection, DbResource, RpcMethod,
} from "@l-v-yonsama/multi-platform-database-drivers";
import dayjs from "dayjs";
import {
  commands, ExtensionContext, NotebookCellData, NotebookCellKind, NotebookEdit,
  window, workspace, WorkspaceEdit,
} from "vscode";
import {
  APPEND_RPC_HISTORY_TO_ACTIVE_NOTEBOOK,
  CREATE_NEW_NOTEBOOK,
  DELETE_ALL_RPC_HISTORY,
  DELETE_RPC_HISTORY,
  EXECUTE_RPC_HISTORY,
  LOAD_DB_SCHEMA,
  NOTEBOOK_TYPE,
  OPEN_RPC_HISTORY_AS_NOTEBOOK,
  OPEN_RPC_HISTORY_IN_INVOKE_PANEL,
  REFRESH_RPC_HISTORIES,
} from "../../constant";
import { makeRpcCellData } from "../../notebook/rpcCell";
import { RpcInvokePanel } from "../../panels/RpcInvokePanel";
import { ResourceTreeProvider } from "../resource/ResourceTreeProvider";
import { RpcInvokeHistory } from "../../types/RpcInvokeHistory";
import { isRestorableRpcHistory, RpcInvokeHistoryStore } from "../../utilities/RpcInvokeHistoryStore";
import { StateStorage } from "../../utilities/StateStorage";
import { HistoryTreeProvider } from "./HistoryTreeProvider";

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
  provider: HistoryTreeProvider,
  stateStorage: StateStorage,
  tree: ResourceTreeProvider
): void => {
  const savedHistory = async (selected: RpcInvokeHistory): Promise<RpcInvokeHistory | undefined> =>
    (await store.list()).find((item) => item.id === selected?.id);

  const openPanel = async (selected: RpcInvokeHistory, autoInvoke = false): Promise<void> => {
    const history = await savedHistory(selected);
    if (!history || history.callKind === "clientStreaming" || history.callKind === "bidiStreaming" ||
      (autoInvoke && !isRestorableRpcHistory(history))) {
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
    if (!history.requestJson) {
      await window.showInformationMessage(
        "The saved RPC request is unavailable. Opening the current method template."
      );
    }
    RpcInvokePanel.render(
      context.extensionUri,
      stateStorage,
      tree,
      method,
      current.service,
      connection.name,
      {
        requestJson: history.requestJson,
        requestMetadata: history.requestMetadata,
        autoInvoke,
      }
    );
  };

  const notebookCells = (
    selected: RpcInvokeHistory,
    selectedHistories?: RpcInvokeHistory[]
  ): NotebookCellData[] => {
    const histories = selectedHistories?.length ? selectedHistories : [selected];
    return histories.flatMap((history) => {
      if (typeof history?.requestJson !== "string" || !("requestDigest" in history)) {
        return [];
      }
      const provenance = new NotebookCellData(
        NotebookCellKind.Markup,
        `_From RPC History: ${history.connectionName} · ${history.path} · ${dayjs(history.executedAt).format("YYYY-MM-DD HH:mm")}_`,
        "markdown"
      );
      const rpc = makeRpcCellData({
        connectionName: history.connectionName,
        service: history.service,
        method: history.method,
        path: history.path,
        callKind: history.callKind,
        dataJson: history.requestJson,
        ...(history.requestMetadata && {
          metadataJson: JSON.stringify(history.requestMetadata, null, 2),
        }),
      });
      return [provenance, rpc];
    });
  };

  context.subscriptions.push(
    commands.registerCommand(REFRESH_RPC_HISTORIES, () => provider.refresh(true)),
    commands.registerCommand(OPEN_RPC_HISTORY_IN_INVOKE_PANEL, (history: RpcInvokeHistory) =>
      openPanel(history)),
    commands.registerCommand(EXECUTE_RPC_HISTORY, (history: RpcInvokeHistory) =>
      openPanel(history, true)),
    commands.registerCommand(OPEN_RPC_HISTORY_AS_NOTEBOOK, async (
      history: RpcInvokeHistory,
      selectedHistories?: RpcInvokeHistory[]
    ) => {
      const cells = notebookCells(history, selectedHistories);
      if (cells.length) {
        await commands.executeCommand(CREATE_NEW_NOTEBOOK, cells);
      }
    }),
    commands.registerCommand(APPEND_RPC_HISTORY_TO_ACTIVE_NOTEBOOK, async (
      history: RpcInvokeHistory,
      selectedHistories?: RpcInvokeHistory[]
    ) => {
      const cells = notebookCells(history, selectedHistories);
      const editor = window.activeNotebookEditor;
      if (!cells.length || !editor || editor.notebook.notebookType !== NOTEBOOK_TYPE) {
        if (cells.length) {
          await window.showErrorMessage("No active notebook editor found.");
        }
        return;
      }
      const edit = new WorkspaceEdit();
      edit.set(editor.notebook.uri, [NotebookEdit.insertCells(editor.selection.end, cells)]);
      await workspace.applyEdit(edit);
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
