const styleId = "db-notebook-rest-renderer-style";

function installStyle() {
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    .dbn-rest { border: 1px solid var(--vscode-panel-border); border-radius: 5px; color: var(--vscode-foreground); margin: 4px 0 8px; overflow: hidden; }
    .dbn-rest__title { background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; padding: 8px 10px; }
    .dbn-rest__tabs { display: flex; gap: 2px; padding: 7px 8px 0; }
    .dbn-rest__tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--vscode-foreground); cursor: pointer; padding: 6px 10px; }
    .dbn-rest__tab[aria-selected="true"] { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-textLink-foreground); }
    .dbn-rest__pane { padding: 8px 10px 10px; }
    .dbn-rest__pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 var(--vscode-editor-font-family, monospace); max-height: 360px; overflow: auto; }
    .dbn-rest__header-name { color: var(--vscode-charts-blue, #569cd6); }
    .dbn-rest__header-value { color: var(--vscode-charts-red, #ce9178); }
    .dbn-rest__error { color: var(--vscode-errorForeground); overflow-wrap: anywhere; padding: 8px 10px 0; }
  `;
  document.head.appendChild(style);
}

function addJson(pre, source) {
  let pretty;
  try {
    pretty = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    pre.textContent = source;
    return;
  }
  const colors = {
    key: "var(--vscode-charts-blue, #569cd6)",
    string: "var(--vscode-charts-red, #ce9178)",
    number: "var(--vscode-charts-green, #b5cea8)",
    literal: "var(--vscode-charts-purple, #c586c0)",
  };
  const tokens =
    /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  let position = 0;
  for (const match of pretty.matchAll(tokens)) {
    const index = match.index;
    pre.append(document.createTextNode(pretty.slice(position, index)));
    const token = match[0];
    const kind = token.startsWith('"')
      ? /^\s*:/.test(pretty.slice(index + token.length))
        ? "key"
        : "string"
      : /^(true|false|null)$/.test(token)
      ? "literal"
      : "number";
    const span = document.createElement("span");
    span.style.color = colors[kind];
    span.textContent = token;
    pre.append(span);
    position = index + token.length;
  }
  pre.append(document.createTextNode(pretty.slice(position)));
}

function appendPre(parent, text, json = false) {
  const pre = document.createElement("pre");
  pre.className = "dbn-rest__pre";
  if (json) addJson(pre, text);
  else pre.textContent = text;
  parent.append(pre);
}

function appendHeaders(parent, headers) {
  const pre = document.createElement("pre");
  pre.className = "dbn-rest__pre";
  if (!Array.isArray(headers) || headers.length === 0) {
    pre.textContent = "No headers";
  } else {
    headers.forEach(({ name, value }, index) => {
      if (index > 0) pre.append(document.createTextNode("\n"));
      const key = document.createElement("span");
      key.className = "dbn-rest__header-name";
      key.textContent = name;
      const headerValue = document.createElement("span");
      headerValue.className = "dbn-rest__header-value";
      headerValue.textContent = value;
      pre.append(key, document.createTextNode(": "), headerValue);
    });
  }
  parent.append(pre);
}

function renderResponse(data, element, activeTab = "data", onSelect = () => {}) {
  const root = document.createElement("section");
  root.className = "dbn-rest";
  const title = document.createElement("div");
  title.className = "dbn-rest__title";
  const entry = data.event?.entry;
  const status = entry?.response;
  const type = status?.content?.mimeType;
  title.textContent = status
    ? `Response · ${status.status} ${status.statusText}${type ? ` · ${type}` : ""} · ${(
        data.elapsedMs / 1000
      ).toFixed(3)} sec`
    : `Response · ${data.outcome} · ${(data.elapsedMs / 1000).toFixed(3)} sec`;
  if (status?.status >= 400) title.style.color = "var(--vscode-errorForeground)";
  root.append(title);
  if (data.error) {
    const error = document.createElement("div");
    error.className = "dbn-rest__error";
    error.textContent = data.error;
    root.append(error);
  }
  const tabs = document.createElement("div");
  tabs.className = "dbn-rest__tabs";
  tabs.setAttribute("role", "tablist");
  const pane = document.createElement("div");
  pane.className = "dbn-rest__pane";
  let active = activeTab === "headers" ? "headers" : "data";
  const show = () => {
    tabs.replaceChildren(
      ...["data", "headers"].map((tab) => {
        const button = document.createElement("button");
        button.className = "dbn-rest__tab";
        button.type = "button";
        button.textContent = tab[0].toUpperCase() + tab.slice(1);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(tab === active));
        button.onclick = () => {
          active = tab;
          onSelect(tab);
          show();
        };
        return button;
      })
    );
    pane.replaceChildren();
    if (active === "headers") {
      appendHeaders(pane, status?.headers);
    } else if (!status) {
      appendPre(pane, "No response");
    } else if (!status.content?.text) {
      appendPre(pane, "No data");
    } else if (status.content.encoding === "base64") {
      appendPre(
        pane,
        `Binary response · ${type ?? "application/octet-stream"} · ${
          status.content.size
        } bytes\nOpen response for details.`
      );
    } else {
      appendPre(pane, status.content.text, /(?:\/json|\+json)/i.test(type ?? ""));
    }
  };
  root.append(tabs, pane);
  element.replaceChildren(root);
  show();
}

export function activate() {
  installStyle();
  const tabs = new Map();
  return {
    renderOutputItem(outputItem, element) {
      const data = outputItem.json();
      renderResponse(data, element, tabs.get(data.cellId), (tab) => tabs.set(data.cellId, tab));
    },
    disposeOutputItem(id) {
      if (id === undefined) tabs.clear();
    },
  };
}
