import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionItemKind,
  DecorationOptions,
  ExtensionContext,
  MarkdownString,
  NotebookCell,
  NotebookCellKind,
  Position,
  Range,
  SnippetString,
  TextDocument,
  TextEditor,
  ThemeColor,
  Uri,
  languages,
  window,
  workspace,
} from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import { log } from "../utilities/logger";
import {
  DbSchema,
  ProposalKind,
  RdsDatabase,
  abbr,
  getProposals,
  getResourcePositions,
  toLines,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { throttle } from "throttle-debounce";
import { NOTEBOOK_TYPE } from "../constant";
import { isJsCell, isJsonCell, isSqlCell } from "../utilities/notebookUtil";
import { setNodeAxiosCompletionItems } from "./intellisenses/nodeAxios";
import { setSqlStatementCompletionItems } from "./intellisenses/sqlStatements";
import { setNodeDriverResolverCompletionItems } from "./intellisenses/nodeDriverResolver";

const PREFIX = "[notebook/intellisense]";

const throttleFunc = throttle(300, async (connectionName: string): Promise<void> => {
  // log(`  ${PREFIX} start throttleFunc`);
  if (!storage.hasConnectionSettingByName(connectionName)) {
    // log(`  ${PREFIX} end throttleFunc. No connection setting.`);
    return;
  }
  const { ok, result } = await storage.loadResource(connectionName, false, false);
  if (ok && result && result[0] instanceof RdsDatabase) {
    rdsDatabase = result[0];
  }
  // log(`  ${PREFIX} end throttleFunc with rdsDatabase`);
});

export async function setupDbResource(connectionName: string) {
  // log(`${PREFIX} setupDbResource`);
  throttleFunc(connectionName);
}

let storage: StateStorage;
let rdsDatabase: RdsDatabase | undefined;

export function activateIntellisense(context: ExtensionContext, stateStorage: StateStorage) {
  log(`${PREFIX} start activateIntellisense`);
  storage = stateStorage;

  context.subscriptions.push(createJsIntellisense());
  context.subscriptions.push(createSQLIntellisense());
  setActivateDecorator(context);
  log(`${PREFIX} end activateIntellisense`);
}

const smallNumberDecorationType = window.createTextEditorDecorationType({
  after: {
    border: "0.5px dotted gray",
    color: new ThemeColor("tab.unfocusedActiveForeground"),
    backgroundColor: new ThemeColor("tab.inactiveBackground"),
    margin: "0 3px",
  },
});

function setActivateDecorator(context: ExtensionContext) {
  // log(`${PREFIX} start setActivateDecorator`);
  let activeEditor = window.activeTextEditor;
  // let activeNotebook = window.activeNotebookEditor?.notebook;
  let cell: NotebookCell | undefined;
  let timeout: NodeJS.Timer | undefined = undefined;

  const triggerUpdateDecorations = (throttle = false) => {
    // log(`${PREFIX} triggerUpdateDecorations`);
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
      // log(`${PREFIX} triggerUpdateDecorations cleartimeout`);
    }
    if (activeEditor && cell) {
      // log(`${PREFIX} triggerUpdateDecorations in active editor`);
      if (throttle) {
        timeout = setTimeout(() => updateDecorations(activeEditor, cell), 500);
      } else {
        updateDecorations(activeEditor, cell);
      }
    }
    // log(`${PREFIX} triggerUpdateDecorations done`);
  };

  context.subscriptions.push(
    workspace.onDidChangeNotebookDocument((ev) => {
      if (
        !ev.notebook ||
        ev.notebook.notebookType !== NOTEBOOK_TYPE ||
        !window.activeTextEditor ||
        ev.cellChanges.length === 0
      ) {
        return;
      }

      const changedCell = ev.cellChanges.find((it) => isSqlCell(it.cell))?.cell;
      if (changedCell) {
        activeEditor = window.visibleTextEditors.find((it) => it.document === changedCell.document);
        cell = changedCell;
        triggerUpdateDecorations(true);
      }
    })
  );

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((e) => {
      activeEditor = undefined;
      if (!e) {
        return;
      }
      const { document } = e;
      if (document.languageId === "sql" && document.uri.scheme === "vscode-notebook-cell") {
        activeEditor = e;
        cell = window.activeNotebookEditor?.notebook
          .getCells()
          .find((it) => it.document === document);
        triggerUpdateDecorations();
      }
    })
  );
  // log(`${PREFIX} end setActivateDecorator`);
}

function updateDecorations(activeEditor: TextEditor | undefined, cell: NotebookCell | undefined) {
  // log(`${PREFIX} start updateDecorations`);
  if (cell === undefined || rdsDatabase === undefined || activeEditor === undefined) {
    return;
  }

  try {
    activeEditor.setDecorations(smallNumberDecorationType, []);

    const { document } = activeEditor;

    if (cell === undefined || cell.metadata?.showComment !== true) {
      return;
    }
    const sql = document.getText();
    const smallNumbers: DecorationOptions[] = [];

    const resList = getResourcePositions({ sql, db: rdsDatabase });
    resList
      .filter((it) => it.comment)
      .forEach((res) => {
        const startPos = document.positionAt(res.offset);
        const endPos = document.positionAt(res.offset + res.length);

        const decoration: DecorationOptions = {
          range: new Range(startPos, endPos),
          hoverMessage: res.comment,
          renderOptions: {
            after: {
              contentText: abbr(res.comment, 20),
            },
          },
        };
        smallNumbers.push(decoration);
      });

    activeEditor.setDecorations(smallNumberDecorationType, smallNumbers);
  } catch (e: any) {
    log(`${PREFIX} Error:${e.message}`);
  }
}

function getStoreKeys(): string[] {
  // log(`${PREFIX} getStoreKeys`);
  if (window.activeNotebookEditor?.notebook === undefined) {
    return [];
  }
  const cells = window.activeNotebookEditor?.notebook?.getCells() ?? [];
  const texts = cells.filter((it) => isJsCell(it)).map((it) => it.document.getText());
  const keys = new Set<string>();
  texts.forEach((text) => {
    const lines = toLines(text);
    lines
      .filter((it) => it.trim().length)
      .forEach((line) => {
        line.replace(/variables.set\(['"]([\w_]+)['"] *,/g, (substring, g1): string => {
          keys.add(g1);
          return "";
        });
      });
  });
  cells
    .filter((it) => isJsonCell(it))
    .forEach((it) => {
      try {
        Object.keys(JSON.parse(it.document.getText())).forEach((k) => keys.add(k));
      } catch (_) {}
    });
  return [...keys];
}

function createJsIntellisense() {
  // log(`${PREFIX} createJsIntellisense`);
  return languages.registerCompletionItemProvider(
    [{ language: "javascript", notebookType: NOTEBOOK_TYPE }],
    {
      provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
      ) {
        const storeKeys = getStoreKeys();
        const storeKeyNames = storeKeys.join(",");
        const text = document.getText();
        const list: CompletionItem[] = [];
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        const lastChar = linePrefix.length > 0 ? linePrefix.substring(linePrefix.length - 1) : "";

        let item = new CompletionItem("variables");
        item.kind = CompletionItemKind.Variable;
        item.detail = "variables";
        list.push(item);

        item = new CompletionItem("variables.set(key, value)");
        item.insertText = new SnippetString("variables.set('${1}', ${2});");
        item.kind = CompletionItemKind.Function;
        item.detail = "Store value";
        list.push(item);

        item = new CompletionItem("variables.get(key)");
        if (storeKeyNames) {
          item.insertText = new SnippetString("variables.get('${1|" + storeKeyNames + "|}');");
        } else {
          item.insertText = new SnippetString("variables.get('${1}');");
        }
        item.kind = CompletionItemKind.Function;
        item.detail = "Get value";
        list.push(item);

        item = new CompletionItem("variables.each(function)");
        item.insertText = new SnippetString("variables.each((val, key) => console.log(key, val));");
        item.kind = CompletionItemKind.Function;
        item.detail = "Loop over all stored values";
        list.push(item);

        storeKeys.forEach((key) => {
          item = new CompletionItem(key);
          item.kind = CompletionItemKind.Variable;
          item.detail = "Stored key";
          list.push(item);
        });

        item = new CompletionItem("setKeyValueOnJsonCell(jsonCellIndex, key, value)");
        if (storeKeyNames) {
          item.insertText = new SnippetString(
            "setKeyValueOnJsonCell(0, '${1|" + storeKeyNames + "|}', ${2});"
          );
        } else {
          item.insertText = new SnippetString("setKeyValueOnJsonCell(0, '${1}', ${2});");
        }
        item.kind = CompletionItemKind.Function;
        item.detail = "Set key's value at the index of json-cell";
        list.push(item);

        item = new CompletionItem("replaceAllOnJsonCell(jsonCellIndex, newJsonObject)");
        item.insertText = new SnippetString("replaceAllOnJsonCell(0, ${1});");
        item.kind = CompletionItemKind.Function;
        item.detail = "Replace jsonObject at the index of json-cell";
        list.push(item);

        const conSettings = storage.getPasswordlessConnectionSettingList();
        const conNamesString = conSettings.map((it) => it.name).join(",");
        conSettings.forEach((it) => {
          item = new CompletionItem(it.name);
          item.kind = CompletionItemKind.Variable;
          item.detail = "Connection setting name";
          item.documentation = `DB type:${it.dbType}`;
          list.push(item);
        });

        // Axios
        setNodeAxiosCompletionItems(list);

        // DBDriverResolver
        setNodeDriverResolverCompletionItems(list, conNamesString);

        return list;
      },
    }
  );
}

export function createDocumentation({
  script,
  ext,
  uri,
}: {
  script: string;
  ext: string;
  uri?: string;
}) {
  const doc = new MarkdownString("```" + ext + "\n\n" + script + "\n```\n");
  if (uri) {
    doc.baseUri = Uri.parse(uri);
  }
  return doc;
}

function createSQLIntellisense() {
  // log(`${PREFIX} createSQLIntellisense`);

  return languages.registerCompletionItemProvider(
    [{ language: "sql", notebookType: NOTEBOOK_TYPE }],
    {
      provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
      ) {
        const sql = document.getText();
        const list: CompletionItem[] = [];
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        const lastChar = linePrefix.length > 0 ? linePrefix.substring(linePrefix.length - 1) : "";
        const m = linePrefix.match(/[ \t]*([ \t".0-9a-zA-Z_$-]+)$/);
        // log(
        //   `${PREFIX} linePrefix:[${linePrefix}] position:${JSON.stringify(
        //     position
        //   )} lastChar:[${lastChar}] match:[${m}]`
        // );
        if (m) {
          let parentWord = "";
          let keyword = "";
          const target = m[1].trim();
          // log(`${PREFIX} target:[${target}]`);
          if (lastChar === ".") {
            const m2 = target.match(/("?[.0-9a-zA-Z_$-]+"?)\.$/);
            if (m2) {
              parentWord = m2[1];
            }
          } else {
            const m2 = target.match(/(("?[.0-9a-zA-Z_$-]+"?)\.)?("?[.0-9a-zA-Z_$-]+"?)$/);
            // log(`${PREFIX} m2:[${m2}]`);
            if (m2) {
              parentWord = m2[2];
              keyword = m2[3];
            }
          }
          // log(
          //   `${PREFIX} linePrefix:[${linePrefix}] keyword:[${keyword}] parentWord:[${parentWord}]`
          // );

          if (rdsDatabase) {
            getProposals({ db: rdsDatabase, sql, keyword, lastChar, parentWord }).forEach((s) => {
              const item = new CompletionItem(s.label);
              item.kind =
                s.kind === ProposalKind.ReservedWord
                  ? CompletionItemKind.Keyword
                  : CompletionItemKind.Variable;
              item.detail = s.detail;
              list.push(item);
            });
          }
        }

        setSqlStatementCompletionItems(list);

        return list;
      },
    }
  );
}
