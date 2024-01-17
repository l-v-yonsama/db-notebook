import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

export const setNodeExecaCompletionItems = (list: CompletionItem[]): void => {
  const spec = `
  interface execa(command:string, args?:string[], options?:Options): Promise<{
  command: string,
  escapedCommand: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  all: any,
  failed: boolean,
  timedOut: boolean,
  isCanceled: boolean,
  killed: boolean
}>`;
  let example = "";

  example = "const result = await execa('${1}', [${2}]);\nconsole.log(result.stdout);";
  appendCompletionItem({
    list,
    label: "Execute a command",
    example,
    spec,
    description: "execa",
  });

  example = `const result = await execa('echo', ["hello world!!"]);\nconsole.log(result.stdout);`;
  appendCompletionItem({
    list,
    label: "Execute echo command example",
    example,
    spec,
    description: "execa",
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
