import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { env, window } from "vscode";
import type { McpServerHandle } from "../../src/mcpServer/server";

vi.mock("../../src/utilities/logger", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { showConnectionInfo } from "../../src/mcpServer/activator";
import { log } from "../../src/utilities/logger";

const TOKEN = "super-secret-token-value";

const makeHandle = (overrides: Partial<McpServerHandle> = {}): McpServerHandle => ({
  url: "http://127.0.0.1:12345/db-notebook-mcp",
  token: TOKEN,
  startedHere: true,
  ...overrides,
});

const loggedText = (): string =>
  (log as Mock).mock.calls.map((args: unknown[]) => args.join(" ")).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("showConnectionInfo", () => {
  it("接続情報を表示するだけの時点でトークンをログに出力しない", async () => {
    (window.showInformationMessage as Mock).mockResolvedValue(undefined);

    await showConnectionInfo(makeHandle());

    const text = loggedText();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("Bearer");
  });

  it("'Copy claude mcp add command' を選んでもトークンをログに出力しない(クリップボードには書き込む)", async () => {
    (window.showInformationMessage as Mock).mockResolvedValue("Copy claude mcp add command");

    await showConnectionInfo(makeHandle());

    expect(env.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(TOKEN));
    const text = loggedText();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("Bearer");
  });

  it("'Copy token' を選んでもトークンをログに出力しない(クリップボードには書き込む)", async () => {
    (window.showInformationMessage as Mock).mockResolvedValue("Copy token");

    await showConnectionInfo(makeHandle());

    expect(env.clipboard.writeText).toHaveBeenCalledWith(TOKEN);
    const text = loggedText();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("Bearer");
  });

  it("'Copy URL' を選んだ場合、秘密情報を含まないURLはログに出力してよい", async () => {
    (window.showInformationMessage as Mock).mockResolvedValue("Copy URL");
    const handle = makeHandle();

    await showConnectionInfo(handle);

    expect(env.clipboard.writeText).toHaveBeenCalledWith(handle.url);
    const text = loggedText();
    expect(text).toContain(handle.url);
    expect(text).not.toContain(TOKEN);
  });
});
