import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Uri } from "vscode";
import type { ExtensionContext } from "vscode";
import { writeLockFile } from "../../src/mcpServer/singleton";
import { McpServerTreeProvider } from "../../src/mcpServerTree/McpServerTreeProvider";

const CLAIM_FILE_NAME = "mcp-server.lock.claim";

let scratchRoot: string;

beforeAll(() => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "McpServerTreeProvider-test-"));
});

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

let ctxSeq = 0;
const makeContext = (): ExtensionContext => {
  const dir = path.join(scratchRoot, `ctx-${ctxSeq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return { globalStorageUri: Uri.file(dir) } as unknown as ExtensionContext;
};

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

describe("McpServerTreeProvider.getChildren", () => {
  it("サーバー未起動なら'Stopped'を返し、起動クレームを一切残さない", async () => {
    const context = makeContext();
    const provider = new McpServerTreeProvider(context);

    // 実際のバグ: 旧実装はここで acquireOrDetect を呼んでいたため、ツリー更新のたびに
    // 起動クレームを取得したまま解放されず、次の本物の起動要求を妨げていた。
    for (let i = 0; i < 3; i++) {
      const children = await provider.getChildren();
      expect(children[0].label).toBe("Stopped");
    }

    const claimFilePath = path.join(context.globalStorageUri.fsPath, CLAIM_FILE_NAME);
    expect(fs.existsSync(claimFilePath)).toBe(false);
  });

  it("サーバー起動中なら'Running'とURLを返す", async () => {
    const context = makeContext();
    const server = http.createServer((_req, res) => res.writeHead(200).end());
    const port = await listen(server);
    await writeLockFile(context, port, "live-token");

    try {
      const provider = new McpServerTreeProvider(context);
      const children = await provider.getChildren();

      expect(children[0].label).toBe("Running");
      expect(children[0].description).toBe(`http://127.0.0.1:${port}/db-notebook-mcp`);
    } finally {
      server.close();
    }
  });
});
