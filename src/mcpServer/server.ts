import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as http from "http";
import { EventEmitter, ExtensionContext } from "vscode";
import { getMcpServerConfig } from "../utilities/configUtil";
import { log, logError } from "../utilities/logger";
import { getOrCreateToken, isAuthorized } from "./auth";
import { getLastUsedPort, setLastUsedPort } from "./preferences";
import {
  acquireOrDetect,
  MCP_PATH,
  ownsLock,
  releaseStartupSlot,
  removeLockFile,
  writeLockFile,
} from "./singleton";
import { registerTools } from "./tools";
import { StateStorage } from "../utilities/StateStorage";

const PREFIX = "[mcpServer/server]";

let httpServer: http.Server | undefined;

const _onDidChangeRunningState = new EventEmitter<void>();
/** Fires whenever this window starts or stops the server -- lets the MCP Server tree view refresh itself without polling. */
export const onDidChangeRunningState = _onDidChangeRunningState.event;

export type McpServerHandle = {
  url: string;
  token: string;
  /** True if this window's process is the one actually listening. */
  startedHere: boolean;
};

export async function startMcpServer(
  context: ExtensionContext,
  stateStorage: StateStorage
): Promise<McpServerHandle> {
  const detection = await acquireOrDetect(context);
  if (!detection.shouldStart) {
    return { ...detection.existing, startedHere: false };
  }

  // `acquireOrDetect` returning `shouldStart: true` means this process now holds the
  // startup claim (see singleton.ts). Release it once bind+writeLockFile is done --
  // succeeded or not -- so a bind failure can't leave every other window's
  // `acquireOrDetect` waiting out its retries for a claim that will never be released.
  try {
    const token = await getOrCreateToken(context);
    const version = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";

    let port = 0;
    const server = http.createServer((req, res) => {
      handleRequest(req, res, token, stateStorage, version, port).catch((e) => {
        logError(`${PREFIX} unhandled error: ${e?.message ?? e}`);
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });

    const config = getMcpServerConfig();
    port = await bind(server, context, config.port);

    httpServer = server;
    await writeLockFile(context, port, token);
    await setLastUsedPort(context, port);
    log(`${PREFIX} started on 127.0.0.1:${port}`);
    _onDidChangeRunningState.fire();

    return { url: `http://127.0.0.1:${port}${MCP_PATH}`, token, startedHere: true };
  } finally {
    await releaseStartupSlot(context);
  }
}

/**
 * Binds to `configuredPort` if the user pinned one explicitly via `mcpServer.port`
 * (failure is fatal -- they asked for that exact port). Otherwise tries the port this
 * server last used, so a restart keeps the same URL valid for already-registered MCP
 * clients; if that port is no longer free, falls back to a fresh OS-assigned one.
 */
async function bind(server: http.Server, context: ExtensionContext, configuredPort: number): Promise<number> {
  if (configuredPort !== 0) {
    return listen(server, configuredPort);
  }
  const rememberedPort = await getLastUsedPort(context);
  if (rememberedPort) {
    try {
      return await listen(server, rememberedPort);
    } catch (e: any) {
      log(`${PREFIX} previous port ${rememberedPort} is unavailable (${e?.message ?? e}); picking a new one`);
    }
  }
  return listen(server, 0);
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("Failed to determine the MCP server's listening port."));
      }
    });
  });
}

export async function stopMcpServer(context: ExtensionContext): Promise<void> {
  if (!httpServer) {
    return;
  }
  if (!(await ownsLock(context))) {
    log(`${PREFIX} this window does not own the running MCP server; not stopping it`);
    return;
  }
  const server = httpServer;
  httpServer = undefined;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await removeLockFile(context);
  log(`${PREFIX} stopped`);
  _onDidChangeRunningState.fire();
}

export function isRunningHere(): boolean {
  return httpServer !== undefined;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  stateStorage: StateStorage,
  version: string,
  port: number
): Promise<void> {
  if (req.url !== MCP_PATH) {
    res.writeHead(404).end();
    return;
  }
  if (!isAuthorized(req, token)) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Stateless mode: a fresh McpServer + transport per request, mirroring the MCP SDK's
  // own `simpleStatelessStreamableHttp` example. There is no persistent session to
  // manage, which keeps the singleton/lock-file story above simple.
  const server = new McpServer({ name: "database-notebook", version });
  registerTools(server, stateStorage);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Mitigates GHSA-w48q-cv73-mx4w (SDK doesn't enable DNS rebinding protection by
    // default pre-1.24.0, and we're pinned below that -- see server.ts's version-pin
    // note). This server is loopback-only and already requires a bearer token, but
    // there's no reason not to also reject requests with an unexpected Host header.
    allowedHosts: ["127.0.0.1", `127.0.0.1:${port}`, "localhost", `localhost:${port}`],
    enableDnsRebindingProtection: true,
  });
  res.on("close", () => {
    transport.close();
    server.server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}
