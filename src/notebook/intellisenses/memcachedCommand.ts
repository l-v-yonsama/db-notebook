import {
  CompletionItem,
  CompletionItemKind,
  SnippetString,
} from "vscode";
import { createDocumentation } from "../intellisense";

type MemcachedCommand = {
  lb: string;
  desc: string;
  snippet: string;
};

const MEMCACHED_COMMANDS: MemcachedCommand[] = [
  {
    lb: "get",
    desc: "Get a value by exact key",
    snippet: "get ${1:key}",
  },
  {
    lb: "cachedump",
    desc: "List keys (partial match supported)",
    snippet: "cachedump ${1:limit} ${2:keyword}",
  },
];

export const setMemcachedCompletionItems = (
  list: CompletionItem[]
): void => {
  MEMCACHED_COMMANDS.forEach(({ lb, desc, snippet }) => {
    const item = new CompletionItem(
      { label: lb, description: desc },
      CompletionItemKind.Keyword
    );

    item.insertText = new SnippetString(snippet);

    item.documentation = createDocumentation({
      example: snippet.replace(/\$\{\d+:?([^}]+)\}/g, "$1"),
      spec:
        lb === "get"
          ? "get <key>\n\nExact match lookup."
          : "cachedump <limit?> <keyword?>\n\nPartial key scan.",
      ext: "txt",
    });

    list.push(item);
  });
};