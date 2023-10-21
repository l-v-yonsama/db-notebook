import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

export const setNodeAxiosCompletionItems = (list: CompletionItem[]): void => {
  let item = new CompletionItem("axios.get data in json format");
  item.insertText = new SnippetString(
    "const url = '${1|https://httpbin.org/ip|}'\n" +
      "const res = await axios.get(url);\n" +
      "writeResponseData(res);"
  );
  item.kind = CompletionItemKind.Function;
  item.detail = "Get data in json format using axios";
  item.documentation = createDocumentation({ script: DOC_AXIS_GET, ext: "js" });
  list.push(item);

  item = new CompletionItem("axios.get (Add Bearer Token Authorization Header)");
  item.insertText = new SnippetString(
    "const url = '${1|https://httpbin.org/ip|}'\n" +
      "const headers = {\n" +
      "//  'Authorization': `Bearer ${variables.get('token')}`,\n" +
      "  'Content-Type': 'application/json'\n" +
      "}\n" +
      "const res = await axios.get(url, { headers });\n" +
      "writeResponseData(res);"
  );
  item.kind = CompletionItemKind.Function;
  item.detail = "Get data in json format using axios";
  item.documentation = createDocumentation({ script: DOC_AXIS_GET, ext: "js" });
  list.push(item);

  item = new CompletionItem("axios.get an image");
  item.insertText = new SnippetString(
    "const url = '${1|https://www.gstatic.com/webp/gallery/1.webp|}'\n" +
      "const res = await axios.get(url, {\n" +
      "  responseType: 'arraybuffer',\n" +
      "});\n" +
      "writeResponseData(res);"
  );
  item.kind = CompletionItemKind.Function;
  item.detail = "Download an Image using axios";
  item.documentation = createDocumentation({ script: DOC_AXIS_GET, ext: "js" });
  list.push(item);

  item = new CompletionItem("axios.post");
  item.insertText = new SnippetString(
    "const url = '${1|https://httpbin.org/post|}';\n" +
      "const body = {a:1, b:'aa'};\n" +
      "const headers = {\n" +
      "//  'Authorization': `Bearer ${variables.get('token')}`,\n" +
      "  'Content-Type': 'application/json'\n" +
      "}\n" +
      "const res = await axios.post(url, body, { headers });\n" +
      "writeResponseData(res);"
  );
  item.kind = CompletionItemKind.Function;
  item.detail = "Post data in json format using axios.";
  item.documentation = createDocumentation({ script: DOC_AXIS_POST, ext: "js" });
  list.push(item);

  item = new CompletionItem("axios.put");
  item.insertText = new SnippetString(
    "const url = '${1|https://httpbin.org/put|}';\n" +
      "const body = {a:1, b:'aa'};\n" +
      "const headers = {\n" +
      "//  'Authorization': `Bearer ${variables.get('token')}`,\n" +
      "  'Content-Type': 'application/json'\n" +
      "}\n" +
      "const res = await axios.put(url, body, { headers });\n" +
      "writeResponseData(res);"
  );
  item.kind = CompletionItemKind.Function;
  item.detail = "Put data in json format using axios.";
  item.documentation = createDocumentation({ script: DOC_AXIS_PUT, ext: "js" });
  list.push(item);

  item = new CompletionItem("axios.delete");
  item.insertText = new SnippetString(
    "const url = '${1|https://httpbin.org/delete|}';\n" +
      "const headers = {\n" +
      "//  'Authorization': `Bearer ${variables.get('token')}`,\n" +
      "  'Content-Type': 'application/json'\n" +
      "}\n" +
      "const res = await axios.delete(url, { headers });\n" +
      "writeResponseData(res);"
  );
  item.kind = CompletionItemKind.Function;
  item.detail = "Delete a resource using axios.";
  item.documentation = createDocumentation({ script: DOC_AXIS_DELETE, ext: "js" });
  list.push(item);
};

const DOC_AXIS_GET = `
axios.get(url: string, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;

const DOC_AXIS_POST = `
axios.post(url: string, data?:any, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;

const DOC_AXIS_PUT = `
axios.put(url: string, data?:any, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;

const DOC_AXIS_DELETE = `
axios.delete(url: string, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;
