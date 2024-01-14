import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

export const setNodeVariablesCompletionItems = (
  list: CompletionItem[],
  storeKeyNames: string
): void => {
  let item = new CompletionItem("variables");
  item.kind = CompletionItemKind.Variable;
  item.detail = "variables";
  list.push(item);

  let example = "";

  // GET
  if (storeKeyNames) {
    example = "variables.get('${1|" + storeKeyNames + "|}');";
  } else {
    example = "variables.get('${1}');";
  }
  appendCompletionItem({
    list,
    label: "Get value",
    example,
    spec: "interface variables.get(key:string): any",
    description: "variables",
  });

  // SET
  if (storeKeyNames) {
    example = "variables.set('${1|" + storeKeyNames + "|}', ${2});";
  } else {
    example = "variables.set('${1}, ${2}');";
  }
  appendCompletionItem({
    list,
    label: "Set value",
    example,
    spec: "interface variables.set(key:string, value:any): void",
    description: "variables",
  });

  // EACH
  item = new CompletionItem({ label: "variables.each(function)", description: "variables" });
  item.insertText = new SnippetString("variables.each((val, key) => console.log(key, val));");
  item.kind = CompletionItemKind.Function;
  item.detail = "Loop over all stored values";
  list.push(item);

  //--------------------------
  // variablesCell
  //--------------------------

  if (storeKeyNames) {
    example = "variablesCell.setKeyValueAtFirst('${1|" + storeKeyNames + "|}', ${2});";
  } else {
    example = "variablesCell.setKeyValueAtFirst('${1}', ${2});";
  }
  appendCompletionItem({
    list,
    label: "Set key's value at the first json-cell",
    example,
    spec: "interface variablesCell.setKeyValueAtFirst(key:string, value:any): void",
    description: "variablesCell",
  });

  if (storeKeyNames) {
    example = "variablesCell.setKeyValueAt(${1|0|}, '${2|" + storeKeyNames + "|}', ${3});";
  } else {
    example = "variablesCell.setKeyValueAt(${1|0|}, '${2}', ${3});";
  }
  appendCompletionItem({
    list,
    label: "Set key's value at the index of json-cell",
    example,
    spec: "interface variablesCell.setKeyValueAt(cellIndex:number, key:string, value:any): void",
    description: "variablesCell",
  });

  example = "variablesCell.replaceAllAtFirst(${1});";
  appendCompletionItem({
    list,
    label: "Replace jsonObject at the first json-cell",
    example,
    spec: "interface variablesCell.replaceAllAtFirst(newJsonObject:any): void",
    description: "variablesCell",
  });

  example = "variablesCell.setKeyValueAt(${1|0|}, ${2});";
  appendCompletionItem({
    list,
    label: "Replace jsonObject at the index of json-cell",
    example,
    spec: "interface variablesCell.setKeyValueAt(cellIndex:number, newJsonObject:any): void",
    description: "variablesCell",
  });
};

const appendCompletionItem = ({
  list,
  label,
  example,
  spec,
  description,
}: {
  list: CompletionItem[];
  label: string;
  example: string;
  spec: string;
  description: string;
}) => {
  let item = new CompletionItem({ label, description });

  item.insertText = new SnippetString(example);
  item.kind = CompletionItemKind.Function;
  item.detail = `${label} using ${description}`;
  item.documentation = createDocumentation({ example, spec, ext: "typescript" });

  list.push(item);

  item = new CompletionItem({ label: `${description}.${label}`, description });

  item.insertText = new SnippetString(example);
  item.kind = CompletionItemKind.Function;
  item.detail = `${label} using ${description}`;
  item.documentation = createDocumentation({ example, spec, ext: "typescript" });

  list.push(item);
};
