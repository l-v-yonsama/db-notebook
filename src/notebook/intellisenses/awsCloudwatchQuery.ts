import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

const KEYWORDS: { lb: string; desc: string }[] = [
  { lb: "display", desc: "Displays a specific field or fields in query results" },
  {
    lb: "fields",
    desc: "Displays specific fields in query results and supports functions and operations you can use to modify field values and create new fields to use in your query",
  },
  {
    lb: "filter",
    desc: "Filters the query to return only the log events that match one or more conditions",
  },
  {
    lb: "pattern",
    desc: "Automatically clusters your log data into patterns. A pattern is shared text structure that recurs among your log fields",
  },
  {
    lb: "diff",
    desc: "Compares the log events found in your requested time period with the log events from a previous time period of equal length, so that you can look for trends and find out if certain log events are new",
  },
  {
    lb: "parse",
    desc: "Extracts data from a log field to create an extracted field that you can process in your query",
  },
  {
    lb: "sort",
    desc: "Displays the returned log events in ascending (asc) or descending (desc) order",
  },
  { lb: "stats", desc: "Calculate aggregate statistics using values in the log fields" },
  {
    lb: "limit",
    desc: "Specifies a maximum number of log events that you want your query to return",
  },
  {
    lb: "dedup",
    desc: "Removes duplicate results based on specific values in fields that you specify",
  },
  {
    lb: "unmask",
    desc: "Displays all the content of a log event that has some content masked because of a data protection policy",
  },
];

const LAMBDA_GENERAL_QUERIES: { lb: string; desc: string; example: string }[] = [
  {
    lb: "Find latest 25 log events",
    desc: "Find the 25 most recently added log events",
    example: "fields @timestamp, @message \n| sort @timestamp desc \n| limit 25",
  },
  {
    lb: "Count exceptions per hour",
    desc: "Get a list of the number of exceptions per hour",
    example:
      "filter @message like /Exception/ \n| stats count(*) as exceptionCount by bin(1h) \n| sort exceptionCount desc",
  },
  {
    lb: "Find non-exception log events",
    desc: "Get a list of log events that aren't exceptions",
    example: "fields @message \n| filter @message not like /Exception/",
  },
  {
    lb: "Find latest log per server",
    desc: "Get the most recent log event for each unique value of the server field",
    example:
      "fields @timestamp, server, severity, message \n| sort @timestamp asc \n| dedup server",
  },
  {
    lb: "Find latest log per server and severity",
    desc: "Get the most recent log event for each unique value of the server field for each severity type",
    example:
      "fields @timestamp, server, severity, message \n| sort @timestamp desc \n| dedup server, severity",
  },
  {
    lb: "Find overprovisioned memory",
    desc: "Determine the amount of overprovisioned memory",
    example:
      'filter @type = "REPORT" \n| stats max(@memorySize / 1000 / 1000) as provisonedMemoryMB,\n  min(@maxMemoryUsed / 1000 / 1000) as smallestMemoryRequestMB,\n  avg(@maxMemoryUsed / 1000 / 1000) as avgMemoryUsedMB,\nmax(@maxMemoryUsed / 1000 / 1000) as maxMemoryUsedMB,\n  provisonedMemoryMB - maxMemoryUsedMB as overProvisionedMB',
  },
];

const API_GW_QUERIES: { lb: string; desc: string; example: string }[] = [
  {
    lb: "Find last 10 4XX errors",
    desc: "Find the last 10 4XX errors",
    example:
      "fields @timestamp, status, ip, path, httpMethod \n| filter status>=400 and status<=499 \n| sort @timestamp desc \n| limit 10",
  },
  {
    lb: "Find top 10 longest API requests",
    desc: "Identify the 10 longest-running Amazon API Gateway requests in your Amazon API Gateway access log group",
    example:
      "fields @timestamp, status, ip, path, httpMethod, responseLatency \n| sort responseLatency desc \n| limit 10",
  },
  {
    lb: "Find top API paths",
    desc: "Return the list of the most popular API paths in your Amazon API Gateway access log group",
    example: "stats count(*) as requestCount by path \n| sort requestCount desc \n| limit 10",
  },
  {
    lb: "Generate API latency report",
    desc: "Create an integration latency report for your Amazon API Gateway access log group",
    example:
      "filter status=200 \n| stats avg(integrationLatency), max(integrationLatency), min(integrationLatency) by bin(1m)",
  },
];

export const setCloudwatchQueryCompletionItems = (list: CompletionItem[]): void => {
  KEYWORDS.forEach(({ lb, desc }) => {
    const item = new CompletionItem({ label: lb, description: desc }, CompletionItemKind.Keyword);
    list.push(item);
  });
  LAMBDA_GENERAL_QUERIES.forEach(({ lb, desc, example }) => {
    const item = new CompletionItem(
      { label: lb, description: "LAMBDA" },
      CompletionItemKind.Snippet
    );
    const snippet = `# ${desc}\n\n${example}`;
    item.insertText = new SnippetString(snippet);
    item.documentation = createDocumentation({ example: snippet, spec: "", ext: "sql" });
    list.push(item);
  });
  API_GW_QUERIES.forEach(({ lb, desc, example }) => {
    const item = new CompletionItem(
      { label: lb, description: "API-GATEWAY" },
      CompletionItemKind.Snippet
    );
    const snippet = `# ${desc}\n\n${example}`;
    item.insertText = new SnippetString(snippet);
    item.documentation = createDocumentation({ example: snippet, spec: "", ext: "sql" });
    list.push(item);
  });
};
