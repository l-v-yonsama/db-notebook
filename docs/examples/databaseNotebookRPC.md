# RPC usage guide

[日本語](./databaseNotebookRPC.ja.md)

Database Notebook can call gRPC methods from the **Invoke RPC panel** or save and run them as **RPC JSON** cells in a `.dbn` notebook. Both support unary, server streaming, client streaming, and bidirectional streaming. SQL and RPC cells can live in the same notebook.

## 1. Create a connection

1. Add a connection in **DB Explorer**, select **RPC** (shown as gRPC in the tree), and enter its name, Host, and Port.
2. Choose a **Definition source**:
   - **Server Reflection** loads services and message types from the server. The server must support reflection.
   - **Local proto** uses an absolute path to a `.proto` file. Add import paths under **Proto include directories**, one per line. You can optionally enable **Verify local proto with server reflection**.
3. Choose **No authentication (plaintext)** or **TLS + Bearer token** for authentication. For TLS + Bearer, enter the token and, if needed, a CA certificate.
4. Optionally set **Stream deadline (ms)**. The default is 300000 ms (five minutes); `0` means no deadline. **Response JSON: Show default values** only changes the display; it does not mean those values were sent or stored.
5. Save and expand the connection in DB Explorer. You can inspect packages, services, methods, request/response Messages, and fields. Selecting a resource shows its attributes under **Resource Properties**.

## 2. Call a method in the Invoke RPC panel

Use a method's **Invoke RPC** icon or context menu in DB Explorer. The **Request** pane is on the left and **Response** is on the right.

- Enter a ProtoJSON object in Request **Data**. Optional **Metadata** is a JSON object whose values are strings or arrays of strings. Only text metadata is supported; binary keys ending in `-bin` cannot be used. The connection setting manages `authorization`, so it cannot be entered here. **Description** shows the message definition.
- For unary and server streaming methods, enter one Data object and select **Invoke**.
- For client and bidirectional streaming, select **Start**, enter the next message in Data, and select **Send** once per message. **Finish Sending** closes the request side and waits for the response. Use **Cancel** to stop early.
- Switch between Response **Data / Headers / Trailers / Description**. After a result is available, **Output HTML** saves an HTML report.

For example, if the request Message has an `id` field, enter:

```json
{
  "id": 26
}
```

To set Metadata, enter something like `{ "x-request-id": "example" }` in its separate tab.

In ProtoJSON, 64-bit integers appear as strings in responses; safe numeric values are accepted in requests. Timestamp and Duration use strings, and bytes use base64 strings.

## 3. Run an RPC notebook cell

Select **Add RPC Request Cell to Notebook** from a DB Explorer method to add a cell for that method. You can also add a normal code cell and set its language to **RPC JSON** (`rpc-json`) using the cell's language selector. In that case, select a connection and method from the cell status bar.

The cell body contains **only Request Data**, as ordinary, unescaped JSON. Do not wrap it in a `dataJson` property or a JSON string. Unary and server streaming cells take one JSON object:

```json
{
  "id": 26
}
```

Client and bidirectional streaming cells take an **array of message objects**. A cell execution sends them in order, closes the request side, and waits for the response. Unlike the panel, the cell does not let you choose when to send each message.

```json
[
  { "value": "first" },
  { "value": "second" }
]
```

Request Data can use notebook shared variables. Write a variable as an entire JSON string value, for example `{ "id": "{{ customerId }}" }`. When the cell runs, `{{ customerId }}` is replaced with the current shared variable value, preserving JSON types such as numbers and booleans. The same syntax works inside each message in a client or bidirectional streaming array. Define variables in a JSON cell marked **Pre-execution** to make them available when running the RPC cell alone. An undefined variable or a value that cannot be represented as JSON stops the call before sending. Request Metadata does not support variable substitution. Histories record the resolved Data that was actually sent; the notebook cell keeps its `{{ ... }}` placeholders.

Use **Edit metadata / Show descriptor** in the cell status bar to open its settings panel. Enter request **Metadata** as a JSON object, such as `{ "x-request-id": "example" }`, and select **Save**; `{}` means no metadata. **Descriptor** shows the selected method definition and provides **Reload schema** and **Insert request template**. Metadata is stored in cell settings, so clearing execution outputs does not remove it. You can reopen the settings panel to view the Descriptor again.

The result shows status, elapsed time, sent/received counts, and **Data / Headers / Trailers** tabs. Use **Output HTML** in the notebook toolbar to export RPC cell requests and their last execution results to an HTML report.

RPC execution outputs are not saved in the `.dbn` file. After reopening a notebook, run its RPC cells again before exporting their responses to HTML.

> Switching an existing cell's language to RPC JSON does not convert its old SQL or JSON body and settings. Set the RPC connection, method, and request body yourself.

## 4. Reuse calls from Histories

The **Histories** view contains both query and RPC history. A stream creates one history entry per call, not one per message. Calls with the same connection, method, and request body share an entry with an execution count. Request Metadata is not part of that grouping key.

| History entry | Available actions |
| --- | --- |
| Unary / server streaming with saved body | **Execute**, **Open in RPC Panel**, **Open as notebook**, **Append to active notebook**, **Delete** |
| Unary / server streaming without saved body | **Open in RPC Panel**, **Delete**. The panel opens the current method template; it cannot restore the old body. |
| Client / bidirectional streaming with saved body | **Open as notebook**, **Append to active notebook**, **Delete**. The panel cannot restore or replay the array of messages. |
| Client / bidirectional streaming without saved body | **Delete** |

The request body limit is 64 KiB. When a body exceeds that limit, actions that need it are unavailable. Nonempty Metadata is saved and restored with the captured request. If a retry fails after a success, the body and Metadata for the last successful result remain, and the failure is recorded separately. Clicking a history row does nothing; use its context menu or an available hover action. The view's delete-all action removes both query and RPC history.

## 5. Use RPC with AI tools

Enable AI tool access for the RPC connection first. Copilot Chat and the local MCP server can use `getDbSchema` to inspect service/method names, the call kind, request and response descriptors, and a ProtoJSON request example. Pass `serviceName` and `methodName` to narrow the result.

Copilot Chat can create or edit `.dbn` notebooks with `rpc-json` cells. Supply a ProtoJSON object as the cell value for unary/server streaming, or an array of objects for client/bidirectional streaming. Set `metadata.rpc.service` and `metadata.rpc.method`; optional outgoing Metadata goes in `metadata.rpc.metadata`. The method path and call kind come from the discovered descriptor. Notebook authoring does not execute the cell.

The `invokeUnaryRpc` tool can execute one unary call directly from Copilot Chat or MCP. It asks for local confirmation of the request and Metadata before sending, records the call in Histories, and applies the connection's AI output masking to the response. Streaming methods remain notebook-only for AI-authored execution.
