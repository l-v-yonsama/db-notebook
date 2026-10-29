import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import {
  Diagnostic,
  DiagnosticSeverity,
  ExtensionContext,
  languages,
  Range,
  TextDocument,
  workspace,
} from "vscode";
import { REST_CELL_LANGUAGE } from "./restCell";

export const registerRestJsonDiagnostics = (context: ExtensionContext): void => {
  const collection = languages.createDiagnosticCollection("rest-json");
  const update = (document: TextDocument): void => {
    if (document.languageId !== REST_CELL_LANGUAGE) {
      collection.delete(document.uri);
      return;
    }
    const source = document.getText();
    const errors: ParseError[] = [];
    if (source.trim()) {
      parse(source, errors, { allowTrailingComma: false, disallowComments: true });
    }
    collection.set(
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
  context.subscriptions.push(collection);
  context.subscriptions.push(workspace.onDidOpenTextDocument(update));
  context.subscriptions.push(workspace.onDidChangeTextDocument((event) => update(event.document)));
  context.subscriptions.push(
    workspace.onDidCloseTextDocument((document) => collection.delete(document.uri))
  );
  for (const document of workspace.textDocuments) {
    update(document);
  }
};
