import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionItemKind,
  ExtensionContext,
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
        line.replace(/store.set\(['"]([\w_]+)['"] *,/g, (substring, g1): string => {
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
      const text = document.getText();
      const list: CompletionItem[] = [];
      const linePrefix = document.lineAt(position).text.substr(0, position.character);
      const lastChar = linePrefix.length > 0 ? linePrefix.substring(linePrefix.length - 1) : "";
      // const m = linePrefix.match(/[ \t]*([ \t".0-9a-zA-Z_$-]+)$/);
      // log(
      //   `${PREFIX} linePrefix:[${linePrefix}] position:${JSON.stringify(
      //     position
      //   )} lastChar:[${lastChar}] match:[${m}]`
      // );
      // if (m) {
      //   let parentWord = "";
      //   let keyword = "";
      //   const target = m[1].trim();
      //   log(`${PREFIX} target:[${target}]`);
      //   if (lastChar === ".") {
      //     const m2 = target.match(/("?[.0-9a-zA-Z_$-]+"?)\.$/);
      //     if (m2) {
      //       parentWord = m2[1];
      //     }
      //   } else {
      //     const m2 = target.match(/(("?[.0-9a-zA-Z_$-]+"?)\.)?("?[.0-9a-zA-Z_$-]+"?)$/);
      //     log(`${PREFIX} m2:[${m2}]`);
      //     if (m2) {
      //       parentWord = m2[2];
      //       keyword = m2[3];
      //     }
      //   }
      //   log(`${PREFIX} linePrefix:[${linePrefix}] keyword:[${keyword}] parentWord:[${parentWord}]`);

      //   if (rdsDatabase) {
      //     getProposals({ db: rdsDatabase, sql, keyword, lastChar, parentWord }).forEach((s) => {
      //       const item = new CompletionItem(s.label);
      //       item.kind =
      //         s.kind === ProposalKind.ReservedWord
      //           ? CompletionItemKind.Keyword
      //           : CompletionItemKind.Variable;
      //       item.detail = s.detail;
      //       list.push(item);
      //     });
      //   }
      // }
      let item = new CompletionItem("store");
      item.kind = CompletionItemKind.Variable;
      item.detail = "store";
      list.push(item);

      item = new CompletionItem("store.set(key, value)");
      item.insertText = new SnippetString("store.set('${1}', ${2});");
      item.kind = CompletionItemKind.Function;
      item.detail = "Store value";
      list.push(item);

      item = new CompletionItem("store.get(key)");
      item.insertText = new SnippetString("store.get('${1}');");
      item.kind = CompletionItemKind.Function;
      item.detail = "Get value";
      list.push(item);

      item = new CompletionItem("store.each(function)");
      item.insertText = new SnippetString("store.each((val, key) => console.log(key, val));");
      item.kind = CompletionItemKind.Function;
      item.detail = "Loop over all stored values";
      list.push(item);

      storeKeys.forEach((key) => {
        item = new CompletionItem(key);
        item.kind = CompletionItemKind.Variable;
        item.detail = "Stored key";
        list.push(item);
      });

      return list;
    },
  });
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
