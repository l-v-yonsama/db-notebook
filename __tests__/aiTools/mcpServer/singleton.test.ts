import { spawnSync } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Uri } from "vscode";
import type { ExtensionContext } from "vscode";
import {
  acquireOrDetect,
  detectRunningServer,
  releaseStartupSlot,
  writeLockFile,
} from "../../../src/aiTools/mcpServer/singleton";

// Mirrors the private CLAIM_FILE_NAME in singleton.ts. There's no public API to plant
// a claim file with an arbitrary (non-`process.pid`) owner -- claimStartupSlot always
// stamps its own pid -- so simulating "a previous process crashed mid-claim" has to
// reach into this implementation detail directly.
const CLAIM_FILE_NAME = "mcp-server.lock.claim";

let scratchRoot: string;

beforeAll(() => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-singleton-test-"));
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

describe("acquireOrDetect", () => {
  it("ロックファイルが無ければshouldStart:trueを返す", async () => {
    const result = await acquireOrDetect(makeContext());
    expect(result.shouldStart).toBe(true);
  });

  it("生きていないポートを指す古いロックファイルは削除された上でshouldStart:trueになる", async () => {
    const context = makeContext();
    const deadServer = http.createServer();
    const deadPort = await listen(deadServer);
    await new Promise<void>((resolve) => deadServer.close(() => resolve()));

    await writeLockFile(context, deadPort, "old-token");

    const result = await acquireOrDetect(context);
    expect(result.shouldStart).toBe(true);
  });

  it("生きているポートを指すロックファイルがあればshouldStart:falseでその情報を返す", async () => {
    const context = makeContext();
    const server = http.createServer((_req, res) => res.writeHead(200).end());
    const port = await listen(server);
    await writeLockFile(context, port, "live-token");

    try {
      const result = await acquireOrDetect(context);
      expect(result.shouldStart).toBe(false);
      if (!result.shouldStart) {
        expect(result.existing).toEqual({
          url: `http://127.0.0.1:${port}/db-notebook-mcp`,
          token: "live-token",
        });
      }
    } finally {
      server.close();
    }
  });

  it("同時に呼び出しても片方だけがshouldStart:trueになり、もう片方は勝った側の起動完了後に既存サーバーを検出する", async () => {
    const context = makeContext();
    const token = "concurrent-token";
    const server = http.createServer((_req, res) => res.writeHead(200).end());
    const port = await listen(server);

    // Mirrors what server.ts's startMcpServer does once acquireOrDetect hands it
    // shouldStart:true: bind (simulated by the already-listening `server` above),
    // record the real lock content, then release the claim.
    const runOne = async () => {
      const result = await acquireOrDetect(context);
      if (result.shouldStart) {
        await writeLockFile(context, port, token);
        await releaseStartupSlot(context);
      }
      return result;
    };

    try {
      const [r1, r2] = await Promise.all([runOne(), runOne()]);

      const starters = [r1, r2].filter((r) => r.shouldStart);
      const detectors = [r1, r2].filter((r) => !r.shouldStart);
      expect(starters).toHaveLength(1);
      expect(detectors).toHaveLength(1);

      const detected = detectors[0];
      if (!detected.shouldStart) {
        expect(detected.existing).toEqual({
          url: `http://127.0.0.1:${port}/db-notebook-mcp`,
          token,
        });
      }
    } finally {
      server.close();
    }
  }, 15000);

  it("クレームの所有プロセスが既に終了していれば、リトライを待たず即座に奪取してshouldStart:trueになる", async () => {
    const context = makeContext();

    // A pid that is guaranteed to no longer exist: spawnSync only returns once the
    // child has exited (and been reaped), so isProcessAlive(deadPid) must be false.
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    const deadPid = dead.pid;
    expect(typeof deadPid).toBe("number");

    const claimFilePath = path.join(context.globalStorageUri.fsPath, CLAIM_FILE_NAME);
    fs.mkdirSync(path.dirname(claimFilePath), { recursive: true });
    // Timestamped as claimed just now -- well inside CLAIM_STALE_MS -- so a fast
    // recovery here can only be explained by the pid-liveness check, not the
    // elapsed-time fallback.
    fs.writeFileSync(
      claimFilePath,
      JSON.stringify({ pid: deadPid, claimedAt: Date.now() }),
      "utf8"
    );

    const start = Date.now();
    const result = await acquireOrDetect(context);
    const elapsed = Date.now() - start;

    expect(result.shouldStart).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("detectRunningServer", () => {
  const claimFilePath = (context: ExtensionContext) =>
    path.join(context.globalStorageUri.fsPath, CLAIM_FILE_NAME);

  it("ロックファイルが無ければundefinedを返し、クレームファイルも作らない", async () => {
    const context = makeContext();

    const result = await detectRunningServer(context);

    expect(result).toBeUndefined();
    expect(fs.existsSync(claimFilePath(context))).toBe(false);
  });

  it("生きていないポートを指すロックファイルがあってもundefinedを返し、クレームファイルを作らない(削除もしない)", async () => {
    const context = makeContext();
    const deadServer = http.createServer();
    const deadPort = await listen(deadServer);
    await new Promise<void>((resolve) => deadServer.close(() => resolve()));
    await writeLockFile(context, deadPort, "old-token");

    const result = await detectRunningServer(context);

    expect(result).toBeUndefined();
    expect(fs.existsSync(claimFilePath(context))).toBe(false);
    // 読み取り専用なので、古いロックファイルであっても勝手に消さない。
    expect(
      fs.existsSync(path.join(context.globalStorageUri.fsPath, "mcp-server.lock.json"))
    ).toBe(true);
  });

  it("生きているポートを指すロックファイルがあればURL/tokenを返す", async () => {
    const context = makeContext();
    const server = http.createServer((_req, res) => res.writeHead(200).end());
    const port = await listen(server);
    await writeLockFile(context, port, "live-token");

    try {
      const result = await detectRunningServer(context);
      expect(result).toEqual({ url: `http://127.0.0.1:${port}/db-notebook-mcp`, token: "live-token" });
    } finally {
      server.close();
    }
  });

  it("回帰テスト: サーバー停止中に何度呼んでも起動クレームを奪わないため、直後のacquireOrDetectは即座にshouldStart:trueになる", async () => {
    // ツリービュー(旧McpServerTreeProvider、現ToolActivityTreeProvider)のgetChildren()が
    // 旧実装のように acquireOrDetect を使っていた場合、ツリービューの自動更新のたびに起動
    // クレームを取得したまま解放されず、停止直後の再起動が毎回「another window is
    // starting」で失敗していた実際のバグの再現。
    const context = makeContext();

    for (let i = 0; i < 5; i++) {
      const result = await detectRunningServer(context);
      expect(result).toBeUndefined();
    }
    expect(fs.existsSync(claimFilePath(context))).toBe(false);

    const start = Date.now();
    const result = await acquireOrDetect(context);
    const elapsed = Date.now() - start;

    expect(result.shouldStart).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });
});
