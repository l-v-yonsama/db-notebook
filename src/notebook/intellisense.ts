import {
  AwsDatabase,
  DBType,
  ProposalKind,
  RdsDatabase,
  getProposals,
  getResourcePositions,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { abbr, toLines } from "@l-v-yonsama/rdh";
import { throttle } from "throttle-debounce";
import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionItemKind,
  DecorationOptions,
  ExtensionContext,
  MarkdownString,
  NotebookCell,
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
import { NOTEBOOK_TYPE } from "../constant";
import { StateStorage } from "../utilities/StateStorage";
import { log } from "../utilities/logger";
import { isJsCell, isJsonValueCell, isSqlCell } from "../utilities/notebookUtil";
import { setCloudwatchQueryCompletionItems } from "./intellisenses/awsCloudwatchQuery";
import { setMemcachedCompletionItems } from "./intellisenses/memcachedCommand";
import { setNodeAxiosCompletionItems } from "./intellisenses/nodeAxios";
import { setNodeDriverResolverCompletionItems } from "./intellisenses/nodeDriverResolver";
import { setNodeExecaCompletionItems } from "./intellisenses/nodeExeca";
import { setNodeVariablesCompletionItems } from "./intellisenses/nodeVariables";
import { setSqlStatementCompletionItems } from "./intellisenses/sqlStatements";

const PREFIX = "[notebook/intellisense]";

const throttleFunc = throttle(400, async (connectionName: string): Promise<void> => {
  log(`  ${PREFIX} throttleFunc(setupDbResource(${connectionName}))`);
  if (!storage.hasConnectionSettingByName(connectionName)) {
    // log(`  ${PREFIX} end throttleFunc. No connection setting.`);
    return;
  }

  if (storage.getDBTypeByConnectionName(connectionName) === DBType.Mqtt) {
    // log(`  ${PREFIX} end throttleFunc. Mqtt is not supported.`);
    return;
  }
  const { ok, result } = await storage.loadResource(connectionName, false, false);
  if (ok && result) {
    const db0 = result.db[0];
    if (db0 instanceof RdsDatabase) {
      sqlDatabase = db0 as RdsDatabase;
    } else {
      const dbs = result.db as AwsDatabase[];
      sqlDatabase = dbs.find((it) => it.serviceType === "DynamoDB");
    }
    dbType = result.dbType;
  }
  // log(`  ${PREFIX} end throttleFunc with sqlDatabase`);
});

export async function setupDbResource(connectionName: string) {
  // log(`${PREFIX} setupDbResource`);
  throttleFunc(connectionName);
}

let storage: StateStorage;
let sqlDatabase: RdsDatabase | AwsDatabase | undefined;
let dbType: DBType | undefined;

export function activateIntellisense(context: ExtensionContext, stateStorage: StateStorage) {
  log(`${PREFIX} start activateIntellisense`);
  storage = stateStorage;

  context.subscriptions.push(createJsIntellisense());
  context.subscriptions.push(createSQLIntellisense());
  context.subscriptions.push(createCloudwatchQueryIntellisense());
  context.subscriptions.push(registerMemcachedCompletionProvider());
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
  if (cell === undefined || sqlDatabase === undefined || activeEditor === undefined) {
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

    const resList = getResourcePositions({ sql, db: sqlDatabase });
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
  } catch (e) {
    if (e instanceof Error) {
      log(`${PREFIX} intellisense Error:${e.message}`);
    } else {
      log(`${PREFIX} intellisense Error:${e}`);
    }
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
    .filter((it) => isJsonValueCell(it))
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

        let item: CompletionItem;

        item = new CompletionItem({ label: "decodeJwt", description: "accessToken" });
        item.kind = CompletionItemKind.Function;
        item.detail = "decodeJwt(token: string): JwtPayload";
        item.documentation = new MarkdownString("", true);
        item.documentation.appendCodeblock(
          `interface decodeJwt(token: string): {header:JwtHeader, payload:JwtPayload}`,
          "typescript"
        );
        list.push(item);

        item = new CompletionItem({ label: "writeResultSetData", description: "rdh" });
        item.kind = CompletionItemKind.Function;
        item.insertText = new SnippetString("writeResultSetData('${1|title|}', ${2|rdh|});");
        item.detail = "Write ResultSetData with a title";
        item.documentation = new MarkdownString("", true);
        item.documentation.appendCodeblock(
          "function writeResultSetData(title: string, rdh: ResultSetData);",
          "typescript"
        );
        list.push(item);

        setNodeVariablesCompletionItems(list, storeKeyNames);

        storeKeys.forEach((key) => {
          item = new CompletionItem({ label: key, description: "variables" });
          item.kind = CompletionItemKind.Variable;
          item.detail = "Stored key";
          list.push(item);
        });

        const conSettings = storage.getPasswordlessConnectionSettingList();
        const conNamesString = conSettings.map((it) => it.name).join(",");
        conSettings.forEach((it) => {
          item = new CompletionItem(it.name);
          item.kind = CompletionItemKind.Variable;
          item.detail = "Connection setting name";
          item.documentation = `DB type:${it.dbType}`;
          list.push(item);
        });

        // Execa
        setNodeExecaCompletionItems(list);

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
  example,
  spec,
  ext,
  uri,
}: {
  example: string;
  spec: string;
  ext: string;
  uri?: string;
}) {
  const doc = new MarkdownString("", true);
  if (example) {
    doc.appendCodeblock(example, ext);
  }
  if (spec) {
    doc.appendCodeblock(spec, ext);
  }
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

          if (sqlDatabase) {
            getProposals({ db: sqlDatabase, sql, keyword, lastChar, parentWord }).forEach((s) => {
              const item = new CompletionItem({ label: s.label, description: "DB resources" });
              item.kind =
                s.kind === ProposalKind.ReservedWord
                  ? CompletionItemKind.Keyword
                  : CompletionItemKind.Variable;
              item.detail = s.detail;
              list.push(item);
            });
          }
        }

        setSqlStatementCompletionItems(list, dbType);

        return list;
      },
    }
  );
}

function createCloudwatchQueryIntellisense() {
  return languages.registerCompletionItemProvider(
    [{ language: "cwql", notebookType: NOTEBOOK_TYPE }],
    {
      provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
      ) {
        const list: CompletionItem[] = [];
        setCloudwatchQueryCompletionItems(list);

        return list;
      },
    }
  );
}

function registerMemcachedCompletionProvider() {
  return languages.registerCompletionItemProvider(
    [{ language: "memcached", notebookType: NOTEBOOK_TYPE }],
    {
      provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
      ) {
        const list: CompletionItem[] = [];
        setMemcachedCompletionItems(list);
        return list;
      },
    }
  );
};