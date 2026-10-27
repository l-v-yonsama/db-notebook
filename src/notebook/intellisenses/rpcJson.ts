import { getRpcRequestFieldHints, RpcDatabase } from "@l-v-yonsama/multi-platform-database-drivers";
import { getLocation, parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import {
  CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  Diagnostic,
  DiagnosticSeverity,
  Disposable,
  ExtensionContext,
  languages,
  Range,
  TextDocument,
  workspace,
} from "vscode";
import { StateStorage } from "../../utilities/StateStorage";
import { getRpcCellMetadata, RPC_CELL_LANGUAGE } from "../rpcCell";

export function registerRpcJsonDiagnostics(context: ExtensionContext): void {
  const diagnostics = languages.createDiagnosticCollection("RPC JSON");
  const update = (document: TextDocument): void => {
    if (document.languageId !== RPC_CELL_LANGUAGE) {
      diagnostics.delete(document.uri);
      return;
    }
    const errors: ParseError[] = [];
    parse(document.getText(), errors, { allowTrailingComma: false, disallowComments: true });
    diagnostics.set(
      document.uri,
      errors.map(
        (error) =>
          new Diagnostic(
            new Range(
              document.positionAt(error.offset),
              document.positionAt(error.offset + Math.max(error.length, 1))
            ),
            printParseErrorCode(error.error),
            DiagnosticSeverity.Error
          )
      )
    );
  };
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(workspace.onDidOpenTextDocument(update));
  context.subscriptions.push(workspace.onDidChangeTextDocument((event) => update(event.document)));
  context.subscriptions.push(
    workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri))
  );
  workspace.textDocuments.forEach(update);
}

/** ProtoJSON property names are resolved by db-drivers; this adapter locates the edited object. */
export const registerRpcJsonCompletion = (stateStorage: StateStorage): Disposable =>
  languages.registerCompletionItemProvider(
    { language: RPC_CELL_LANGUAGE, scheme: "vscode-notebook-cell" },
    {
      async provideCompletionItems(document, position, token) {
        const cell = workspace.notebookDocuments
          .flatMap((notebook) => notebook.getCells())
          .find((item) => item.document.uri.toString() === document.uri.toString());
        if (!cell) {
          return [];
        }
        const metadata = getRpcCellMetadata(cell);
        if (!metadata.connectionName || !metadata.rpc.service || !metadata.rpc.method) {
          return [];
        }

        const text = document.getText();
        const offset = document.offsetAt(position);
        const location = getLocation(text, offset);
        if (!location.isAtPropertyKey) {
          return [];
        }
        const loaded = await stateStorage.loadResource(metadata.connectionName, false, true);
        if (token.isCancellationRequested || !loaded.ok || !loaded.result) {
          return [];
        }
        const database = loaded.result.db.find((item) => item instanceof RpcDatabase);
        const method = database?.children
          .flatMap((pkg) => pkg.children)
          .find((service) => service.fullName === metadata.rpc.service)
          ?.children.find(
            (item) => item.name === metadata.rpc.method && item.path === metadata.rpc.path
          );
        if (!database || !method) {
          return [];
        }

        const propertyPath = location.path.slice(0, -1);
        const messagePath = method.requestStream && typeof propertyPath[0] === "number"
          ? propertyPath.slice(1)
          : propertyPath;
        const hints = getRpcRequestFieldHints(
          method,
          database.messageDefinitions,
          messagePath
        );
        const previous = location.previousNode;
        const replaceKey =
          previous?.type === "property" &&
          offset >= previous.offset &&
          offset <= previous.offset + previous.length;
        const range = replaceKey
          ? new Range(
              document.positionAt(previous.offset),
              document.positionAt(previous.offset + previous.length)
            )
          : new Range(position, position);
        const afterKey = replaceKey ? text.slice(previous.offset + previous.length) : "";
        const hasColon = /^\s*:/.test(afterKey);
        return hints.map((hint) => {
          const item = new CompletionItem(hint.name, CompletionItemKind.Property);
          item.detail = hint.type;
          item.insertText = `${JSON.stringify(hint.name)}${hasColon ? "" : ": "}`;
          item.range = range;
          if (hint.deprecated) {
            item.tags = [CompletionItemTag.Deprecated];
          }
          return item;
        });
      },
    },
    '"'
  );
