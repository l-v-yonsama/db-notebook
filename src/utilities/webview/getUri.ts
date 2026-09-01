import { Uri, Webview } from "vscode";

/**
 * A helper function which will get the webview URI of a given file or resource.
 *
 * @remarks This URI can be used within a webview's HTML as a link to the
 * given file/resource.
 *
 * @param webview A reference to the extension webview
 * @param extensionUri The URI of the directory containing the extension
 * @param pathList An array of strings representing the path to a file/resource
 * @returns A URI pointing to the file/resource
 */
export function getUri(webview: Webview, extensionUri: Uri, pathList: string[]): Uri {
  // Join the extension URI with the provided path segments
  const resourceUri = Uri.joinPath(extensionUri, ...pathList);

  // Convert the resource URI to a Webview URI
  const webviewUri = webview.asWebviewUri(resourceUri);

  return webviewUri;
}
