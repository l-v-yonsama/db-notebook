import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";

export const setSqlStatementCompletionItems = (list: CompletionItem[]): void => {
  let item = new CompletionItem("select");
  item.insertText = new SnippetString("SELECT ${2} \nFROM ${1} \nLIMIT 100");
  item.kind = CompletionItemKind.Function;
  item.detail = "SELECT STATEMENT";
  list.push(item);

  item = new CompletionItem("insert");
  item.insertText = new SnippetString("INSERT INTO ${1}\n ($2)\n VALUES ()");
  item.kind = CompletionItemKind.Function;
  item.detail = "INSERT STATEMENT";
  list.push(item);

  item = new CompletionItem("update");
  item.insertText = new SnippetString("UPDATE ${1} SET\n ($2)");
  item.kind = CompletionItemKind.Function;
  item.detail = "UPDATE STATEMENT";
  list.push(item);

  item = new CompletionItem("delete");
  item.insertText = new SnippetString("DELETE FROM ${1} \nWHERE\n ($2)");
  item.kind = CompletionItemKind.Function;
  item.detail = "DELETE STATEMENT";
  list.push(item);
};
