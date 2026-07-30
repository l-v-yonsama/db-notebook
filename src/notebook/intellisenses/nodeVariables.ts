import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

// Only the snippets whose key argument suggests real, discovered store keys stay here --
// that's domain data (what keys does this notebook actually use) the forwarded/built-in
// TS language service can never know about. Signature-only completions (member names,
// argument shapes with no notebook-specific data) are covered by that forwarding instead;
// see jsLanguageBridge/requestForwarder.ts.
export const setNodeVariablesCompletionItems = (
  list: CompletionItem[],
  storeKeyNames: string
): void => {
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
