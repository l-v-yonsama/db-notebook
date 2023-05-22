import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionItemKind,
  ExtensionContext,
  MarkdownString,
  NotebookCellKind,
  Position,
  SnippetString,
  TextDocument,
  Uri,
  languages,
  window,
} from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import { log } from "../utilities/logger";
import {
  ProposalKind,
  RdsDatabase,
  getProposals,
  tolines,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { throttle } from "throttle-debounce";

const PREFIX = "[intellisense]";

const throttleFunc = throttle(300, async (connectionName: string) => {
  if (!storage.hasConnectionSettingByName(connectionName)) {
    return;
  }
  const db = await storage.loadResource(connectionName, false, false);
  if (db && db[0] instanceof RdsDatabase) {
    rdsDatabase = db[0];
  }
});

export async function setupDbResource(connectionName: string) {
  throttleFunc(connectionName);
}

let storage: StateStorage;
let rdsDatabase: RdsDatabase | undefined;

export function activateIntellisense(context: ExtensionContext, stateStorage: StateStorage) {
  storage = stateStorage;

  context.subscriptions.push(createJsIntellisense());
  context.subscriptions.push(createSQLIntellisense());
}

function getStoreKeys(): string[] {
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
  return languages.registerCompletionItemProvider([{ language: "javascript" }], {
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
  });
}

function createDriverResolverCompletionItem(
  label: string,
  conNamesString: string,
  bodyScript: string,
  detail: string,
  docString: string
) {
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
  return languages.registerCompletionItemProvider("sql", {
    provideCompletionItems(
      document: TextDocument,
      position: Position,
      token: CancellationToken,
      context: CompletionContext
    ) {
      //   const snippetCompletion = new CompletionItem("Good part of the day");
      //   snippetCompletion.insertText = new SnippetString(
      //     "Good ${1|morning,afternoon,evening|}. It is ${1}, right?"
      //   );
      //   const commitCharacterCompletion = new CompletionItem("console");
      //   commitCharacterCompletion.commitCharacters = ["."];
      //   commitCharacterCompletion.documentation = new MarkdownString("Press `.` to get `console.`");
      //   // a completion item that retriggers IntelliSense when being accepted,
      //   // the `command`-property is set which the editor will execute after
      //   // completion has been inserted. Also, the `insertText` is set so that
      //   // a space is inserted after `new`
      //   const commandCompletion = new CompletionItem("new");
      //   commandCompletion.kind = CompletionItemKind.Keyword;
      //   commandCompletion.insertText = "new ";
      //   commandCompletion.command = {
      //     command: "editor.action.triggerSuggest",
      //     title: "Re-trigger completions...",
      //   };

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
        log(`${PREFIX} linePrefix:[${linePrefix}] keyword:[${keyword}] parentWord:[${parentWord}]`);

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
  });
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
