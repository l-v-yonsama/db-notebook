import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

export const setSqlStatementCompletionItems = (
  list: CompletionItem[],
  dbType: DBType | undefined
): void => {
  let example: string;
  if (dbType === DBType.SQLServer) {
    example = "SELECT TOP 100 ${2} \nFROM ${1}";
    list.push(createCompletionItem({ label: "select", example }));
  } else {
    example = "SELECT ${2} \nFROM ${1} \nLIMIT 100";
    list.push(createCompletionItem({ label: "select", example }));
  }

  example = "INSERT INTO ${1}\n ($2)\n VALUES ()";
  list.push(createCompletionItem({ label: "insert", example }));

  example = "UPDATE ${1} SET\n $2";
  list.push(createCompletionItem({ label: "update", example }));

  example = "DELETE FROM ${1} \nWHERE\n $2";
  list.push(createCompletionItem({ label: "delete", example }));

  example = "TRUNCATE TABLE ${1}";
  list.push(createCompletionItem({ label: "truncate", example }));
};

const createCompletionItem = ({
  label,
  example,
}: {
  label: string;
  example: string;
}): CompletionItem => {
  const item = new CompletionItem({ label, description: "sql" });

  item.insertText = new SnippetString(example);
  item.kind = CompletionItemKind.Function;
  item.detail = `${label} statement`;
  item.documentation = createDocumentation({ example, spec: "", ext: "sql" });
  return item;
};
