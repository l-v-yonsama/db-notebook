import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

export const setNodeAxiosCompletionItems = (list: CompletionItem[]): void => {
  // GET

  let example =
    "const url = '${1|https://httpbin.org/ip|}';\n" +
    "const res = await axios.get(url);\n\n" +
    "// Save the contents of the HttpResponse as cell output data.\n" +
    "writeResponseData(res);";

  appendCompletionItem({
    list,
    label: "Get data in json format",
    example,
    spec: DOC_AXIS_GET,
    description: "axis",
  });

  example =
    "const url = '${1|https://httpbin.org/ip|}';\n" +
    "const headers = {\n" +
    "  'Authorization': `Bearer ${variables.get('token')}`,\n" +
    "  'Content-Type': 'application/json'\n" +
    "}\n" +
    "const res = await axios.get(url, { headers });\n\n" +
    "// Save the contents of the HttpResponse as cell output data.\n" +
    "writeResponseData(res);";

  appendCompletionItem({
    list,
    label: "Get data by specifying a token",
    example,
    spec: DOC_AXIS_GET,
    description: "axis",
  });

  example =
    "const url = '${1|https://www.gstatic.com/webp/gallery/1.webp|}'\n" +
    "const res = await axios.get(url, {\n" +
    "  responseType: 'arraybuffer',\n" +
    "});\n" +
    "writeResponseData(res);";

  appendCompletionItem({
    list,
    label: "Get an image",
    example,
    spec: DOC_AXIS_GET,
    description: "axis",
  });

  // POST

  example =
    "const url = '${1|https://httpbin.org/post|}';\n" +
    "const body = {a:1, b:'aa'};\n" +
    "const headers = {\n" +
    "//  'Authorization': `Bearer ${variables.get('token')}`,\n" +
    "  'Content-Type': 'application/json'\n" +
    "}\n" +
    "const res = await axios.post(url, body, { headers });\n" +
    "writeResponseData(res);";

  appendCompletionItem({
    list,
    label: "Post data in json format",
    example,
    spec: DOC_AXIS_POST,
    description: "axis",
  });

  // PUT

  example =
    "const url = '${1|https://httpbin.org/put|}';\n" +
    "const body = {a:1, b:'aa'};\n" +
    "const headers = {\n" +
    "//  'Authorization': `Bearer ${variables.get('token')}`,\n" +
    "  'Content-Type': 'application/json'\n" +
    "}\n" +
    "const res = await axios.put(url, body, { headers });\n" +
    "writeResponseData(res);";

  appendCompletionItem({
    list,
    label: "Put data in json format",
    example,
    spec: DOC_AXIS_PUT,
    description: "axis",
  });

  // DELETE

  example =
    "const url = '${1|https://httpbin.org/delete|}';\n" +
    "const headers = {\n" +
    "//  'Authorization': `Bearer ${variables.get('token')}`,\n" +
    "  'Content-Type': 'application/json'\n" +
    "}\n" +
    "const res = await axios.delete(url, { headers });\n" +
    "writeResponseData(res);";

  appendCompletionItem({
    list,
    label: "Delete a resource",
    example,
    spec: DOC_AXIS_DELETE,
    description: "axis",
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

const DOC_AXIS_GET = `
interface axios.get(url: string, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;

const DOC_AXIS_POST = `
interface axios.post(url: string, data?:any, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;

const DOC_AXIS_PUT = `
interface axios.put(url: string, data?:any, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;

const DOC_AXIS_DELETE = `
interface axios.delete(url: string, config?: AxiosRequestConfig): Promise<{
  data: any;
  status: number;
  statusText: string;
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig;
  request?: any;
}>`;
