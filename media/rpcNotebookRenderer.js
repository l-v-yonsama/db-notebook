const styleId = "db-notebook-rpc-renderer-style";
const jsonColors = {
  "dbn-rpc__json-key": "var(--vscode-charts-blue, #569cd6)",
  "dbn-rpc__json-string": "var(--vscode-charts-red, #ce9178)",
  "dbn-rpc__json-number": "var(--vscode-charts-green, #b5cea8)",
  "dbn-rpc__json-literal": "var(--vscode-charts-purple, #c586c0)",
};

function installStyle() {
  const style = document.getElementById(styleId) ?? document.createElement("style");
  style.id = styleId;
  style.textContent = `
    .dbn-rpc { border: 1px solid var(--vscode-panel-border); border-radius: 5px; color: var(--vscode-foreground); margin: 4px 0 8px; overflow: hidden; }
    .dbn-rpc__title { background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; padding: 8px 10px; }
    .dbn-rpc__tabs { display: flex; gap: 2px; padding: 7px 8px 0; }
    .dbn-rpc__tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--vscode-foreground); cursor: pointer; padding: 6px 10px; }
    .dbn-rpc__tab[aria-selected="true"] { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-textLink-foreground); }
    .dbn-rpc__pane { padding: 8px 10px 10px; }
    .dbn-rpc__pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 var(--vscode-editor-font-family, monospace); max-height: 360px; overflow: auto; }
    .dbn-rpc__error { color: var(--vscode-errorForeground); margin-bottom: 8px; }
  `;
  if (!style.isConnected) document.head.appendChild(style);
}

function pretty(value) {
  if (value === undefined || value === null) return "None";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function appendJson(pre, content) {
  try {
    JSON.parse(content);
  } catch {
    pre.append(document.createTextNode(content));
    return;
  }
  const tokenPattern = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  let position = 0;
  for (const match of content.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index;
    pre.append(document.createTextNode(content.slice(position, index)));
    const span = document.createElement("span");
    span.className = token.startsWith('"')
      ? /^\s*:/.test(content.slice(index + token.length))
        ? "dbn-rpc__json-key"
        : "dbn-rpc__json-string"
      : token === "true" || token === "false" || token === "null"
      ? "dbn-rpc__json-literal"
      : "dbn-rpc__json-number";
    span.style.color = jsonColors[span.className];
    span.textContent = token;
    pre.append(span);
    position = index + token.length;
  }
  pre.append(document.createTextNode(content.slice(position)));
}

function renderResponse(data, element, activeTab = "data", onSelect) {
  const root = document.createElement("section");
  root.className = "dbn-rpc";
  const title = document.createElement("div");
  title.className = "dbn-rpc__title";
  const status = data.status
    ? `${data.status.name}(${data.status.code})`
    : data.outcome || "Running";
  const counts = [
    ...(data.sentCount === undefined ? [] : [`${data.sentCount} Sent`]),
    `${data.receivedCount ?? 0} Received`,
  ];
  const duration = ((data.elapsedMs ?? 0) / 1000).toFixed(3);
  title.textContent = `Response · ${status} · ${counts.join(", ")} (${duration} sec)`;
  const tabs = document.createElement("div");
  tabs.className = "dbn-rpc__tabs";
  tabs.setAttribute("role", "tablist");
  const pane = document.createElement("div");
  pane.className = "dbn-rpc__pane";
  let active = activeTab;
  const show = () => {
    tabs.replaceChildren(
      ...["data", "headers", "trailers"].map((tab) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dbn-rpc__tab";
        button.textContent = tab[0].toUpperCase() + tab.slice(1);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", active === tab ? "true" : "false");
        button.addEventListener("click", () => {
          active = tab;
          onSelect(active);
          show();
        });
        return button;
      })
    );
    const pre = document.createElement("pre");
    pre.className = "dbn-rpc__pre";
    if (active === "data" && Array.isArray(data.messages)) {
      if (data.messages.length === 0) {
        pre.textContent = "No messages";
      } else {
        data.messages.forEach((item, index) => {
          if (index > 0) pre.append(document.createTextNode("\n\n"));
          pre.append(document.createTextNode(`#${item.index ?? index + 1}\n`));
          appendJson(pre, pretty(item.contents));
        });
      }
    } else {
      const value = active === "data" ? data.contents : data[active];
      if (value === undefined) {
        pre.textContent = active === "data" ? "No messages" : active === "headers" ? "No headers" : "No trailers";
      } else {
        appendJson(pre, pretty(value));
      }
    }
    if (data.error && active === "data") {
      const error = document.createElement("div");
      error.className = "dbn-rpc__error";
      error.textContent = data.error;
      pane.replaceChildren(error, pre);
    } else {
      pane.replaceChildren(pre);
    }
  };
  root.append(title, tabs, pane);
  element.replaceChildren(root);
  show();
}

export function activate() {
  installStyle();
  const responseTabs = new Map();
  return {
    renderOutputItem(outputItem, element) {
      const data = outputItem.json();
      renderResponse(data, element, responseTabs.get(data.cellId), (tab) =>
        responseTabs.set(data.cellId, tab)
      );
    },
    disposeOutputItem(id) {
      if (id === undefined) responseTabs.clear();
    },
  };
}
