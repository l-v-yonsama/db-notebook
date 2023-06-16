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
  ProposalKind,
  RdsDatabase,
  getProposals,
  getResourcePositions,
  tolines,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { throttle } from "throttle-debounce";
import { NOTEBOOK_TYPE } from "../constant";
import { abbr } from "../utilities/stringUtil";
import { isSqlCell } from "../utilities/notebookUtil";

const PREFIX = "[notebook/intellisense]";

const throttleFunc = throttle(300, async (connectionName: string): Promise<void> => {
  log(`  ${PREFIX} start throttleFunc`);
  if (!storage.hasConnectionSettingByName(connectionName)) {
    log(`  ${PREFIX} end throttleFunc`);
    return;
  }
  const db = await storage.loadResource(connectionName, false, false);
  if (db && db[0] instanceof RdsDatabase) {
    rdsDatabase = db[0];
  }
  log(`  ${PREFIX} end throttleFunc with rdsDatabase`);
});

export async function setupDbResource(connectionName: string) {
  log(`${PREFIX} setupDbResource`);
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
  log(`${PREFIX} start setActivateDecorator`);
  let activeEditor = window.activeTextEditor;
  // let activeNotebook = window.activeNotebookEditor?.notebook;
  let cell: NotebookCell | undefined;
  let timeout: NodeJS.Timer | undefined = undefined;

  const triggerUpdateDecorations = (throttle = false) => {
    log(`${PREFIX} triggerUpdateDecorations`);
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (activeEditor && cell) {
      if (throttle) {
        timeout = setTimeout(() => updateDecorations(activeEditor, cell), 500);
      } else {
        updateDecorations(activeEditor, cell);
      }
    }
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
  log(`${PREFIX} end setActivateDecorator`);
}

function updateDecorations(activeEditor: TextEditor | undefined, cell: NotebookCell | undefined) {
  log(`${PREFIX} start updateDecorations`);
  if (cell === undefined || rdsDatabase === undefined || activeEditor === undefined) {
    log(`${PREFIX} end updateDecorations`);
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

  log(`${PREFIX} end updateDecorations`);
}

function getStoreKeys(): string[] {
  log(`${PREFIX} getStoreKeys`);
  if (window.activeNotebookEditor?.notebook === undefined) {
    return [];
  }
  const cells = window.activeNotebookEditor?.notebook?.getCells() ?? [];
  const texts = cells
    .filter((it) => it.kind === NotebookCellKind.Code && it.document.languageId === "javascript")
    .map((it) => it.document.getText());
  const keys = new Set<string>();
  texts.forEach((text) => {
    const lines = tolines(text);
    lines
      .filter((it) => it.trim().length)
      .forEach((line) => {
        line.replace(/variables.set\(['"]([\w_]+)['"] *,/g, (substring, g1): string => {
          keys.add(g1);
          return "";
        });
      });
  });
  return [...keys];
}

function createJsIntellisense() {
  log(`${PREFIX} createJsIntellisense`);
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
        item.insertText = new SnippetString("variables.get('${1|" + storeKeyNames + "|}');");
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

        const conSettings = storage.getPasswordlessConnectionSettingList();
        const conNamesString = conSettings.map((it) => it.name).join(",");
        conSettings.forEach((it) => {
          item = new CompletionItem(it.name);
          item.kind = CompletionItemKind.Variable;
          item.detail = "Connection setting name";
          item.documentation = `DB type:${it.dbType}`;
          list.push(item);
        });

        // driverResolver
        item = createDriverResolverCompletionItem(
          "workflow",
          conNamesString,
          "  // return await driver.xxx;\n",
          "Execute workflow",
          DOCUMENT_OF_WORKFLOW
        );
        list.push(item);

        item = createDriverResolverCompletionItem(
          "viewData",
          conNamesString,
          "  return await driver.viewData('${2}'); -- tableName \n",
          "Get table records",
          DOCUMENT_OF_VIEW_DATA
        );
        list.push(item);

        item = createDriverResolverCompletionItem(
          "scanLogGroup",
          conNamesString,
          "  const now = new Date();\n" +
            "  const startTime = now.getTime() - 1 * 60 * 60 * 1000;\n" +
            "  const endTime = now.getTime();\n" +
            "\n" +
            "  const logService = driver.getClientByServiceType('Cloudwatch');\n" +
            "  return await logService.scanLogGroup({\n" +
            "    target: 'test',\n" +
            "    keyword: 'ERROR',\n" +
            "    startTime,\n" +
            "    endTime,\n" +
            "    limit: 1000,\n" +
            "  });",
          "Search log-records in log-group",
          DOCUMENT_OF_SCAN_LOG_GROUP
        );
        list.push(item);
        return list;
      },
    }
  );
}

function createDriverResolverCompletionItem(
  label: string,
  conNamesString: string,
  bodyScript: string,
  detail: string,
  docString: string
) {
  log(`${PREFIX} createDriverResolverCompletionItem`);
  const item = new CompletionItem("driverResolver." + label);
  item.insertText = new SnippetString(
    "const { ok, message, result } = await driverResolver\n" +
      ".getInstance()\n" +
      ".workflow(getConnectionSettingByName('${1|" +
      conNamesString +
      "|}'), async (driver) => {\n" +
      bodyScript +
      "});\n" +
      "console.log('ok', ok);\n" +
      "console.log('message', message);\n" +
      "console.log('result', result?.toString());"
  );
  item.kind = CompletionItemKind.Function;
  item.detail = detail;
  item.documentation = createDocumentation({ script: docString, ext: "js" });
  return item;
}

function createDocumentation({ script, ext, uri }: { script: string; ext: string; uri?: string }) {
  const doc = new MarkdownString("```" + ext + "\n" + script + "\n```");
  if (uri) {
    doc.baseUri = Uri.parse(uri);
  }
  return doc;
}

function createSQLIntellisense() {
  log(`${PREFIX} createSQLIntellisense`);

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
        log(
          `${PREFIX} linePrefix:[${linePrefix}] position:${JSON.stringify(
            position
          )} lastChar:[${lastChar}] match:[${m}]`
        );
        if (m) {
          let parentWord = "";
          let keyword = "";
          const target = m[1].trim();
          log(`${PREFIX} target:[${target}]`);
          if (lastChar === ".") {
            const m2 = target.match(/("?[.0-9a-zA-Z_$-]+"?)\.$/);
            if (m2) {
              parentWord = m2[1];
            }
          } else {
            const m2 = target.match(/(("?[.0-9a-zA-Z_$-]+"?)\.)?("?[.0-9a-zA-Z_$-]+"?)$/);
            log(`${PREFIX} m2:[${m2}]`);
            if (m2) {
              parentWord = m2[2];
              keyword = m2[3];
            }
          }
          log(
            `${PREFIX} linePrefix:[${linePrefix}] keyword:[${keyword}] parentWord:[${parentWord}]`
          );

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

        return list;
      },
    }
  );
}

const DOCUMENT_OF_WORKFLOW = `workflow<T extends BaseDriver, U = any>(setting: ConnectionSetting, f: (driver: T) => Promise<U>): Promise<GeneralResult<U>>;`;

const DOCUMENT_OF_VIEW_DATA = `... in workflow.
viewData(tableName: string, options?: {
  schemaName?: string;
  columnNames?: string[];
  maxRows?: number;
  compareKeys?: CompareKey[];
}): Promise<ResultSetDataHolder>;
`;

const DOCUMENT_OF_SCAN_LOG_GROUP = `... in workflow.
scanLogGroup(params: {
    target: string;
    parentTarget?: string;
    limit: number;
    withValue?: boolean | 'auto';
    keyword?: string;
    startTime?: number;
    endTime?: number;
    targetResourceType?: ResourceType;
}): Promise<ResultSetDataHolder>;
`;
