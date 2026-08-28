# Using Database Notebook's AI Tools via a Standalone MCP Server

Database Notebook can also run a real [MCP](https://modelcontextprotocol.io/) server — a local
Streamable HTTP server hosted inside the extension itself — so tools outside VS Code entirely
(Claude Code, Claude Desktop, Cursor, MCP Inspector, or any other MCP client) can list your
connections, inspect schemas, and run queries, using the exact same connections you've already
configured in the DB Explorer.

This is the external-client counterpart to
[Using Database Notebook's AI Tools from GitHub Copilot Chat](./lmToolsUsageGuide.md). The two
share the same connection opt-in policy and, for every tool both surfaces have in common, the exact
same input/output — only the transport and the confirmation mechanism differ:

| | Copilot Chat tools | MCP server |
| --- | --- | --- |
| Reachable from | VS Code's own Copilot Chat only | Any MCP client, in or outside VS Code |
| Transport | In-process `vscode.lm.registerTool` | Local HTTP (`http://127.0.0.1:<port>/db-notebook-mcp`), bearer token |
| Enabled by default | No (per-connection opt-in) | No (must be started explicitly) |
| Write confirmation | Database Notebook's own dialog | The connecting MCP client's own tool-approval UI |
| Notebook authoring (`createDbNotebook`/`editDbNotebook`) | Yes | No — needs the VS Code Notebook API, in-process only |

## TOC

- 1. [Overview](#1-overview)
- 2. [Prerequisites](#2-prerequisites)
  - 2.1. [Enable a connection for AI tool use](#21-enable-a-connection-for-ai-tool-use)
- 3. [Starting the server](#3-starting-the-server)
  - 3.1. [Multiple VS Code windows](#31-multiple-vs-code-windows)
  - 3.2. [Configuration](#32-configuration)
- 4. [Connecting an MCP client](#4-connecting-an-mcp-client)
  - 4.1. [Claude Code CLI](#41-claude-code-cli)
  - 4.2. [Codex CLI / Codex IDE extension / ChatGPT Desktop (Work)](#42-codex-cli--codex-ide-extension--chatgpt-desktop-work)
  - 4.3. [Other MCP clients](#43-other-mcp-clients)
- 5. [Registering, re-registering, and rotating the token](#5-registering-re-registering-and-rotating-the-token)
  - 5.1. [Initial registration](#51-initial-registration)
  - 5.2. [Re-registering after the URL or token changes](#52-re-registering-after-the-url-or-token-changes)
  - 5.3. [Rotating the token on purpose](#53-rotating-the-token-on-purpose)
- 6. [Confirmation for writes](#6-confirmation-for-writes)
- 7. [Tool reference](#7-tool-reference)
- 8. [Troubleshooting](#8-troubleshooting)

## 1. Overview

The server only exists while VS Code is open with Database Notebook active — closing that window
(or reloading the extension host) stops it. It binds to `127.0.0.1` only (never reachable from
another machine) and requires a bearer token on every request, including the initial handshake.

| Tool | MCP tool name | What it does |
| --- | --- | --- |
| List Database Connections | `listDbConnections` | Lists the connections available to AI tools |
| Test Database Connection | `testDbConnection` | Live connectivity check for one named connection |
| Get Database Schema | `getDbSchema` | Table DDL / resource structure for one connection |
| Run Database Query | `runDbQuery` | Runs one SQL statement (or one PartiQL statement against DynamoDB) |
| Run Database Transaction | `runDbTransaction` | Runs several SQL statements as one all-or-nothing transaction |
| Scan Database Resource | `scanDbResource` | Searches a non-SQL resource (Redis, Memcache, MQTT, Keycloak, Auth0, AWS S3/SQS/CloudWatch) |
| Get Performance Tuning Context | `getPerformanceTuningContext` | Returns a read-only execution-plan (SQL) or static access-path/Capacity (DynamoDB PartiQL) snapshot, with schema, statistics, and physical-health/CloudWatch facts, for one statement |

`createDbNotebook`/`editDbNotebook` (creating/editing `.dbn` files) are **not** exposed here — see
the table above for why — use Copilot Chat in VS Code for those.

## 2. Prerequisites

- An MCP client that supports the **Streamable HTTP** transport with a custom `Authorization`
  header (Claude Code CLI is used for every example below; see [4.2](#42-codex-cli--codex-ide-extension--chatgpt-desktop-work)
  for Codex or the ChatGPT desktop app's **Work** mode, or [4.3](#43-other-mcp-clients) for
  others).
- At least one connection configured in the DB Explorer, with AI tool access turned on for it.
  Connections are **opt-in** — this is the same flag Copilot's tools use, so a connection already
  enabled for Copilot is automatically visible here too, and vice versa.

### 2.1. Enable a connection for AI tool use

1. Open the connection in the DB Explorer's connection settings form (create, edit, or duplicate).
2. Find the **AI Tools** field and check **"Allow AI tools (e.g. Copilot Chat) to check and query
   this connection"**.
3. Save the connection.

This flag defaults to **off**, including for connections created before this feature existed — so
if a connection you expect to see doesn't show up in `listDbConnections`, this is the first thing
to check.

## 3. Starting the server

The server never starts on its own. In the sidebar's **MCP Server** section (a sibling of DB
Explorer/Query histories/Help, not inside DB Explorer itself), click the broadcast icon
(**Start Database Notebook MCP Server**), or run it from the Command Palette as
**Database Notebook: Start Database Notebook MCP Server**. A notification shows the server's URL
and offers three actions (kept to three so VS Code doesn't shrink every label into an unreadable
"Co…" trying to fit them all on one row):

*(Ports and tokens shown throughout this guide, like `57731` or `0123456789abcdef...`, are made-up
examples illustrating the shape of real output — yours will be different every time the server
starts. Only `<angle-bracket>` placeholders are meant to be typed in literally.)*

- **Claude command** — copies a ready-to-run `claude mcp add` registration command (see
  [5.1](#51-initial-registration))
- **Codex setup** — opens `~/.codex/config.toml` in a normal editor tab *and* copies a
  `[mcp_servers.db_notebook]` TOML block (current URL and token already filled in) to the
  clipboard in the same step, ready to paste (see
  [4.2](#42-codex-cli--codex-ide-extension--chatgpt-desktop-work))
- **More…** — opens a picker with the remaining, less-common actions: **Copy URL** (just the URL,
  e.g. `http://127.0.0.1:57731/db-notebook-mcp`, for a client whose settings UI has separate
  URL/header fields), **Copy token** (just the bearer token, for the same kind of client), and
  **Open MCP setup guide** (this page)

Once running, the toolbar icon switches to **Stop Database Notebook MCP Server**
(`Database Notebook: Stop Database Notebook MCP Server` in the Command Palette), and the **MCP
Server** section itself shows a live "Running" / "Stopped" status (with the URL alongside it when
running) — this reflects reality even if a *different* VS Code window is the one actually running
it ([3.1](#31-multiple-vs-code-windows)). The URL's `/db-notebook-mcp` path is deliberately
specific (rather than the more common generic `/mcp`) so it stays identifiable at a glance if
you're also running other local MCP servers.

That notification auto-dismisses after a while, and once it's gone, its copy buttons go with it.
If you need the URL/token again later — e.g. you took a while configuring a client and came back
to find the popup closed — click **Show Connection Info** (also visible in the toolbar and Command
Palette whenever the server is running) to bring the same dialog back up, without restarting
anything.

### 3.1. Multiple VS Code windows

Database Notebook's connections are stored per-machine, not per-workspace, so every open VS Code
window sees the same connections regardless of which window ran **Start**. The server is a
singleton: clicking **Start** in a second window detects the first window's already-running server
and shows you its existing URL/token instead of starting a second one. **Stop** only actually stops
the server from the window that started it — running it from any other window just tells you it
isn't running there.

### 3.2. Configuration

Two settings, under `mcpServer.*`:

- **`mcpServer.autoStart`** (boolean, default `false`) — start the server automatically when the
  extension activates, instead of requiring **Start MCP Server**.
- **`mcpServer.port`** (number, default `0`) — `0` reuses the port from the last time the server
  ran on this machine (falling back to a free OS-assigned port if that one is no longer available);
  set a fixed value to pin the port explicitly instead.

## 4. Connecting an MCP client

### 4.1. Claude Code CLI

The simplest path is to paste in the command from **Claude command**
([3](#3-starting-the-server)) — it already has the current URL and token filled in:

```bash
claude mcp add --transport http db-notebook http://127.0.0.1:57731/db-notebook-mcp \
  --header "Authorization: Bearer 0123456789abcdef0123456789abcdef0123456789abcdef"
```

Confirm it connected:

```bash
$ claude mcp list
db-notebook: http://127.0.0.1:57731/db-notebook-mcp (HTTP) - ✓ Connected
```

From here, just ask Claude Code a question in chat — it decides on its own when to call a tool, the
same way Copilot Chat's Agent mode does (see [7](#7-tool-reference)).

### 4.2. Codex CLI / Codex IDE extension / ChatGPT Desktop (Work)

The ChatGPT desktop app's **Work** experience and Codex Desktop/CLI/IDE extension can use this
local MCP server after its definition is registered in `~/.codex/config.toml`. The registration is
shared by those supported experiences, whether they were launched from the Dock, a terminal, or an
editor. This is a plain [TOML](https://toml.io/) config file, not something the extension writes to
for you: **Database Notebook only opens it and offers a snippet to paste — it never edits it
automatically.**

**Important:** this does not mean that the regular **Chat** mode in ChatGPT can use the local MCP
server. In the currently tested setup, Database Notebook MCP tools were available in **ChatGPT
Work** and **Codex**, but not in **Chat**. Do not describe this local `127.0.0.1` server as
generally available to ChatGPT; the client experience must explicitly support the MCP connection.

1. In the connection info dialog ([3](#3-starting-the-server)), click **Codex setup**. This opens
   `~/.codex/config.toml` in an editor tab *and* copies a block shaped like this to the clipboard,
   with the current URL and token already filled in — both in one click:

   ```toml
   [mcp_servers.db_notebook]
   url = "http://127.0.0.1:57731/db-notebook-mcp"
   http_headers = { Authorization = "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef" }
   ```

   If `~/.codex/config.toml` doesn't exist yet, you're offered a choice between creating an empty
   one (and opening it, then continuing as above) or going straight to this guide instead.
2. Insert the copied block as a new top-level MCP server section. The easiest way to find the
   correct location is to look for the existing sections whose names start with
   `[mcp_servers.` (for example, `[mcp_servers.node_repl]` or `[mcp_servers.computer-use]`).
   Paste the new block **after the last `[mcp_servers.*]` section and before the next unrelated
   section**, such as `[shell_environment_policy.set]`, `[desktop]`, or `[projects."..."]`.

   For example, if the file contains this:

   ```toml
   [mcp_servers.computer-use]
   command = "..."
   args = ["mcp"]
   enabled = false

   [shell_environment_policy.set]
   BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab"
   ```

   insert the copied block between those two sections:

   ```toml
   [mcp_servers.computer-use]
   command = "..."
   args = ["mcp"]
   enabled = false

   [mcp_servers.db_notebook]
   url = "http://127.0.0.1:57731/db-notebook-mcp"
   http_headers = { Authorization = "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef" }

   [shell_environment_policy.set]
   BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab"
   ```

   Do not paste it inside a section such as `[mcp_servers.node_repl.env]`. In TOML, the text in
   square brackets starts a new section; the new block must begin at the left margin with its own
   `[mcp_servers.db_notebook]` header. If a `[mcp_servers.db_notebook]` block is already there from
   a previous setup, **replace** that block instead of adding a second one — TOML doesn't merge
   duplicate table headers, and Codex's behavior with two of them is undefined.

   Save the file after inserting the block.
3. Save the file, then fully quit and relaunch the ChatGPT desktop app (Work mode) or Codex
   Desktop. Closing or minimizing the window alone may leave the application running, so use the
   application's **Quit** or **Exit** command, or the **Quit**/**Exit** option from its Dock or
   taskbar menu. For the Codex CLI or IDE extension, end the current process or session and start
   a new one. The client does not reload `~/.codex/config.toml` while it is running.

`http_headers` is how Codex attaches the `Authorization: Bearer <token>` header on every request;
this is the same static-token model Claude Code CLI uses in [4.1](#41-claude-code-cli), just spelled
differently for Codex's config format. Codex also supports a `bearer_token_env_var` form that reads
the token from a shell environment variable instead — that isn't used here, since Dock-launched apps
don't reliably inherit shell `export`s, while `~/.codex/config.toml` is read the same way regardless
of how the client was launched.

Whenever the token changes ([5.3](#53-rotating-the-token-on-purpose)), redo step 1 onward — the URL
usually stays the same across a normal restart, but the token in the pasted block goes stale the
moment it's rotated.

This flow assumes the client and VS Code are running on the **same Mac**, exactly like every other
client in this guide ([1](#1-overview)). It doesn't apply to regular Chat mode, ChatGPT Web, Claude
Web, or the OpenAI Responses API's hosted MCP support — those all need a separately supported
connection path and, for hosted clients, a publicly reachable server, which is out of scope here
(see [OpenAI's MCP docs](https://developers.openai.com/codex/extend/mcp/) for that setup instead).

### 4.3. Other MCP clients

Any client that speaks Streamable HTTP and lets you attach a custom header can connect using the
same URL and `Authorization: Bearer <token>` header — for example Claude Desktop, Cursor, or the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) dev tool. Exact configuration
syntax (a JSON config file vs. a settings UI vs. CLI flags) varies by client and changes over time,
so check that client's own docs for the current steps; the URL/token pair from
[3](#3-starting-the-server) is everything it needs.

**Running VS Code in a devcontainer or over Remote-SSH:** the server binds to `127.0.0.1` inside
*that* environment, not your local machine — an MCP client running directly on your laptop can't
reach it unless you forward the port (VS Code's **Ports** panel) or also run the client from inside
the same remote environment.

## 5. Registering, re-registering, and rotating the token

### 5.1. Initial registration

Follow [4.1](#41-claude-code-cli) (or your client's equivalent). One thing worth knowing about the
generated `claude mcp add` command specifically: it doesn't pass `-s`, so it registers under
Claude Code's default **local** scope — tied to whichever project directory your terminal was in
when you ran it, invisible from any other project. Since `db-notebook`'s connections are machine-wide
rather than tied to one project, you may prefer adding `-s user` yourself so it's available from
every Claude Code project on the machine:

```bash
claude mcp add --transport http db-notebook http://127.0.0.1:57731/db-notebook-mcp \
  --header "Authorization: Bearer 0123456789abcdef0123456789abcdef0123456789abcdef" -s user
```

### 5.2. Re-registering after the URL or token changes

Thanks to the port/token persistence described in [3](#3-starting-the-server), a normal VS Code
restart keeps the same URL and token — most of the time you never need to touch the registration
again after [5.1](#51-initial-registration). You only need to redo it when:

- You ran **Regenerate MCP Server Token** ([5.3](#53-rotating-the-token-on-purpose))
- The previously-used port happened to be taken by something else when the server last started
  (rare; the notification/log line still tells you the port that was actually used)
- You're registering from a different machine, or after a clean reinstall

`claude mcp add` refuses to register over an existing name rather than silently overwriting it or
creating a duplicate entry:

```bash
$ claude mcp add --transport http db-notebook http://127.0.0.1:9/db-notebook-mcp --header "Authorization: Bearer test"
MCP server db-notebook already exists in local config
```

So remove the stale entry first, then add the fresh one:

```bash
claude mcp remove db-notebook -s local   # use -s user instead if you registered with -s user
claude mcp add --transport http db-notebook <new URL> --header "Authorization: Bearer <new token>"
```

`claude mcp get db-notebook` shows what's currently registered — URL, token, scope, and live
status — which is a quick way to check whether you actually need to redo this before starting the
server back up:

```bash
$ claude mcp get db-notebook
db-notebook:
  Scope: Local config (private to you in this project)
  Status: ✘ Failed to connect
  Type: http
  URL: http://127.0.0.1:54321/db-notebook-mcp
  Headers:
    Authorization: Bearer fedcba9876543210fedcba9876543210fedcba9876543210

To remove this server, run: claude mcp remove db-notebook -s local
```

"Failed to connect" here only means the registered URL/token don't currently match a live server —
it doesn't distinguish "VS Code is closed" from "the port changed" from "the token was rotated".
Start the server and compare its URL against what's registered to tell those apart.

### 5.3. Rotating the token on purpose

Run **Database Notebook: Regenerate Database Notebook MCP Server Token** — from the Command
Palette, or by right-clicking the **MCP Server** row in the sidebar — to issue a brand-new token,
for example if you suspect the old one leaked (shared clipboard history, screen share, etc.). If
the server is currently running in this VS Code window, it restarts in place, normally on the
*same* port (see [3.2](#32-configuration)), so only the token actually changes. Either way, follow
[5.2](#52-re-registering-after-the-url-or-token-changes) afterward to update the registration —
regenerating the token deliberately invalidates every client currently registered with the old one.

The confirmation dialog only has room to say the token changed; the extension's Output channel
(**View → Output**, then pick **database-notebook** from the dropdown) prints the fuller
consequence — a bordered block spelling out that every already-registered client will start
getting 401s until reconfigured — so it's still visible if you miss the dialog or come back to
this later.

## 6. Confirmation for writes

Copilot Chat's tools show a Database Notebook confirmation dialog before any write/DDL statement.
There's no equivalent hook in the MCP protocol, so for `runDbQuery` and `runDbTransaction`,
**confirmation before running is entirely up to the connecting MCP client's own tool-approval UI**
instead — for Claude Code CLI, that's the usual "allow this tool call?" prompt you already see for
any other tool. The DB-engine-level read-only session enforcement (for MySQL/Postgres/SQLite; SQL
Server has no such mechanism, so every statement there needs the client's confirmation regardless
of type) still applies exactly as it does for Copilot's tools.

## 7. Tool reference

Every tool listed in [1](#1-overview) shares its implementation with the matching Copilot Chat
tool, so the input fields and result text are identical — the only difference is how you invoke it
and how writes get confirmed ([6](#6-confirmation-for-writes)). Rather than repeat all seven tools'
examples here, see
[the Copilot Chat guide's Tool reference](./lmToolsUsageGuide.md#5-tool-reference) for the full set
(request shape, sample output, error shapes) — just drop the `#` prefix from a tool's name to get
its MCP tool name (e.g. `#getDbSchema` → `getDbSchema`).

For performance investigation, use `getPerformanceTuningContext`. It supports MySQL, PostgreSQL,
SQL Server, and Oracle, and — for an AWS connection configured for DynamoDB — a PartiQL `SELECT`
statement too, returning the estimated execution plan (SQL) or a static access-path classification
(DynamoDB, `Query` vs. a full `Scan`) together with relevant table/index definitions,
statistics/Capacity mode, physical-health signals or recent CloudWatch metrics, and collection
diagnostics. It **never executes the supplied statement**: this tool always requests an estimated
plan or a static classification, never `ANALYZE`, a real DynamoDB `Query`/`Scan`, or any item read.
The result can contain SQL/PartiQL literals and DDL/table definitions exactly as collected, so
handle it as database-sensitive information. For example:

> Why is this query likely slow on localMysql? Use the performance tuning context and give only
> evidence-based recommendations.

```json
{
  "connectionName": "localMysql",
  "sql": "SELECT * FROM orders WHERE DATE(created_at) = '2025-12-15'"
}
```

Use `databaseName` when the connection has no default database, and `schemaName` when table
resolution needs an explicit schema (for example, PostgreSQL). The tool returns facts only; the MCP
client's model is responsible for interpreting them and proposing changes.

One example, end to end, using the running example from
[the main Database Notebook examples page](./databaseNotebook.md) (a `customer` table on a
connection named `localMysql`):

**Prompt(EN)** — typed into Claude Code's chat, same as any other question

`Show me the structure of the customer table on localMysql`

**Prompt(JA)**

`localMysql の customer テーブルのスキーマ定義を教えて`

Claude Code decides on its own to call `getDbSchema`:

```json
{ "connectionName": "localMysql", "tableName": "customer" }
```

```sql
CREATE TABLE `customer` (
  `customer_no` int NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `age` int DEFAULT NULL,
  PRIMARY KEY (`customer_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
```

## 8. Troubleshooting

- **401 Unauthorized, or the client reports it can't connect** — the registered token no longer
  matches what the server currently expects. Almost always means either the server isn't running
  right now, or you previously ran **Regenerate MCP Server Token** — see
  [5.2](#52-re-registering-after-the-url-or-token-changes).
- **Connection refused** — the server isn't running (start it, [3](#3-starting-the-server)), or
  `mcpServer.port` is pinned to a value nothing is currently listening on, or you're hitting a
  networking boundary like a devcontainer's loopback ([4.3](#43-other-mcp-clients)).
- **`claude mcp add` says the server "already exists"** — expected; it never silently overwrites an
  existing entry with the same name in the same scope. Remove the old one first
  ([5.2](#52-re-registering-after-the-url-or-token-changes)).
- **Codex or the ChatGPT desktop app (Work mode) still can't connect after editing
  `~/.codex/config.toml`** — almost always
  a missed restart ([4.2](#42-codex-cli--codex-ide-extension--chatgpt-desktop-work)): none of Codex's
  hosts re-read that file while running. Also check for a stray duplicate
  `[mcp_servers.db_notebook]` block left over from an earlier setup — TOML doesn't merge repeated
  table headers, so having two produces undefined behavior rather than a clear error.
- **A connection you expect doesn't show up / a tool says "no connection named X was found" even
  though X exists** — check the **AI Tools** checkbox on that connection
  ([2.1](#21-enable-a-connection-for-ai-tool-use)). A connection that exists but isn't enabled is
  reported identically to one that doesn't exist at all.
- **`createDbNotebook`/`editDbNotebook` aren't available** — expected; they depend on the VS Code
  Notebook API and only work in-process, so they're Copilot Chat-only (see the table in
  [1](#1-overview)).
- **Two VS Code windows, unsure which one actually owns the running server** — it doesn't matter
  for connecting a client (both windows report the same URL/token, [3.1](#31-multiple-vs-code-windows)) —
  it only matters for **Stop**, which silently no-ops in a window that isn't the owner.
- **[MCP Inspector](https://github.com/modelcontextprotocol/inspector)'s "Direct" connection type
  fails with a CORS error** — expected; "Direct" has Inspector's own browser UI call the server
  directly, and the server doesn't send `Access-Control-Allow-Origin` (it isn't meant to be called
  from arbitrary web pages). Use Inspector's **"Via Proxy"** connection type instead — it routes the
  request through Inspector's own local proxy process, which isn't subject to the browser's CORS
  restrictions.
