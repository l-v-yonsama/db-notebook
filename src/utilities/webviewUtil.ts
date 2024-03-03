import { Uri, Webview } from "vscode";
import { getUri } from "./getUri";
import { getNonce } from "./getNonce";

export const createWebviewContent = (
  webview: Webview,
  extensionUri: Uri,
  componentName: string
): string => {
  // The CSS file from the Vue build output
  const stylesUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.css"]);
  // The JS file from the Vue build output
  const scriptUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.js"]);
  const codiconsUri = getUri(webview, extensionUri, [
    "webview-ui",
    "build",
    "assets",
    "codicon",
    "codicon.css",
  ]);

  const nonce = getNonce();

  let htmlString = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${
              webview.cspSource
            }; font-src ${
    webview.cspSource
  } data:; img-src * data:; media-src * data:; script-src 'nonce-${nonce}';">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
            <link href="${codiconsUri}" rel="stylesheet" />
            <title>${componentName ?? ""}</title>
          </head>
          <body style="padding:0">
            <div id="app">Now loading...</div>
            <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
          </body>
        </html>
      `;

  return htmlString;
};
