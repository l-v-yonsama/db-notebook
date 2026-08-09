import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { env, window, workspace } from "vscode";
import type { McpServerHandle } from "../../../src/aiTools/mcpServer/server";

vi.mock("../../../src/utilities/logger", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { showConnectionInfo } from "../../../src/aiTools/mcpServer/activator";
import { log } from "../../../src/utilities/logger";

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

  it("通知のボタンは3つ('Claude command' / 'Codex setup' / 'More…')に絞られている", async () => {
    (window.showInformationMessage as Mock).mockResolvedValue(undefined);

    await showConnectionInfo(makeHandle());

    const buttons = (window.showInformationMessage as Mock).mock.calls[0].slice(1);
    expect(buttons).toEqual(["Claude command", "Codex setup", "More…"]);
  });

  it("'Claude command' を選んでもトークンをログに出力しない(クリップボードには書き込む)", async () => {
    (window.showInformationMessage as Mock).mockResolvedValue("Claude command");

    await showConnectionInfo(makeHandle());

    expect(env.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(TOKEN));
    const text = loggedText();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("Bearer");
  });

  describe("'More…'", () => {
    it("QuickPickで'Copy token'を選んでもトークンをログに出力しない(クリップボードには書き込む)", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("More…");
      (window.showQuickPick as Mock).mockResolvedValueOnce("Copy token");

      await showConnectionInfo(makeHandle());

      expect(env.clipboard.writeText).toHaveBeenCalledWith(TOKEN);
      const text = loggedText();
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("Bearer");
    });

    it("QuickPickで'Copy URL'を選んだ場合、秘密情報を含まないURLはログに出力してよい", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("More…");
      (window.showQuickPick as Mock).mockResolvedValueOnce("Copy URL");
      const handle = makeHandle();

      await showConnectionInfo(handle);

      expect(env.clipboard.writeText).toHaveBeenCalledWith(handle.url);
      const text = loggedText();
      expect(text).toContain(handle.url);
      expect(text).not.toContain(TOKEN);
    });

    it("QuickPickで'Open MCP setup guide'を選ぶとガイドを外部ブラウザで開く", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("More…");
      (window.showQuickPick as Mock).mockResolvedValueOnce("Open MCP setup guide");

      await showConnectionInfo(makeHandle());

      expect(env.openExternal).toHaveBeenCalledTimes(1);
      const openedUri = (env.openExternal as Mock).mock.calls[0][0];
      expect(String(openedUri.fsPath ?? openedUri)).toContain("mcpServerUsageGuide");
    });

    it("QuickPickで何も選ばずキャンセルしても何も起きない", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("More…");
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);

      await showConnectionInfo(makeHandle());

      expect(env.clipboard.writeText).not.toHaveBeenCalled();
      expect(env.openExternal).not.toHaveBeenCalled();
    });
  });

  describe("'Codex setup'", () => {
    it("~/.codex/config.toml が既に存在する場合、エディタで開き設定断片(URL/tokenを含む)をクリップボードへコピーする(トークンはログに出さない)", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("Codex setup");
      (workspace.fs.stat as Mock).mockResolvedValueOnce({});
      const handle = makeHandle();

      await showConnectionInfo(handle);

      expect(workspace.openTextDocument).toHaveBeenCalledTimes(1);
      const openedUri = (workspace.openTextDocument as Mock).mock.calls[0][0];
      expect(openedUri.fsPath).toMatch(/\.codex[\\/]config\.toml$/);
      expect(window.showTextDocument).toHaveBeenCalledTimes(1);
      expect(workspace.fs.writeFile).not.toHaveBeenCalled();
      expect(env.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("[mcp_servers.db_notebook]")
      );
      expect(env.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(handle.url));
      expect(env.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(TOKEN));
      const text = loggedText();
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("Bearer");
    });

    it("~/.codex/config.toml が存在せず'Create and open'を選んだ場合、空ファイルを作成してから開き設定断片をコピーする", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("Codex setup");
      (workspace.fs.stat as Mock).mockRejectedValueOnce(new Error("not found"));
      (window.showWarningMessage as Mock).mockResolvedValueOnce("Create and open");

      await showConnectionInfo(makeHandle());

      expect(workspace.fs.createDirectory).toHaveBeenCalledTimes(1);
      expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      expect(workspace.openTextDocument).toHaveBeenCalledTimes(1);
      expect(window.showTextDocument).toHaveBeenCalledTimes(1);
      expect(env.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("[mcp_servers.db_notebook]")
      );
    });

    it("警告ダイアログ表示中に別プロセスがファイルを作成した場合、空ファイルで上書きせずそのまま開く(競合状態対策)", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("Codex setup");
      (workspace.fs.stat as Mock)
        .mockRejectedValueOnce(new Error("not found")) // first check: doesn't exist yet
        .mockResolvedValueOnce({}); // re-check right before writing: now it does
      (window.showWarningMessage as Mock).mockResolvedValueOnce("Create and open");

      await showConnectionInfo(makeHandle());

      expect(workspace.fs.createDirectory).not.toHaveBeenCalled();
      expect(workspace.fs.writeFile).not.toHaveBeenCalled();
      expect(workspace.openTextDocument).toHaveBeenCalledTimes(1);
      expect(window.showTextDocument).toHaveBeenCalledTimes(1);
    });

    it("~/.codex/config.toml が存在せず案内を選んだ場合、ファイルを作らずセットアップガイドを開く", async () => {
      (window.showInformationMessage as Mock).mockResolvedValueOnce("Codex setup");
      (workspace.fs.stat as Mock).mockRejectedValueOnce(new Error("not found"));
      (window.showWarningMessage as Mock).mockResolvedValueOnce("Open MCP setup guide");

      await showConnectionInfo(makeHandle());

      expect(workspace.fs.writeFile).not.toHaveBeenCalled();
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
      expect(env.clipboard.writeText).not.toHaveBeenCalled();
      expect(env.openExternal).toHaveBeenCalledTimes(1);
      const openedUri = (env.openExternal as Mock).mock.calls[0][0];
      expect(String(openedUri.fsPath ?? openedUri)).toContain("mcpServerUsageGuide");
    });

    it("ファイルを開いた後の案内メッセージで'Open MCP setup guide'を選ぶとガイドを開く", async () => {
      (window.showInformationMessage as Mock)
        .mockResolvedValueOnce("Codex setup")
        .mockResolvedValueOnce("Open MCP setup guide");
      (workspace.fs.stat as Mock).mockResolvedValueOnce({});

      await showConnectionInfo(makeHandle());

      expect(env.openExternal).toHaveBeenCalledTimes(1);
    });
  });

  describe("reason: 'regenerated'", () => {
    it("ダイアログの文言がトークン再生成を伝える内容に変わる(トークン自体は出力しない)", async () => {
      (window.showInformationMessage as Mock).mockResolvedValue(undefined);
      const handle = makeHandle();

      await showConnectionInfo(handle, "regenerated");

      const dialogText = (window.showInformationMessage as Mock).mock.calls[0][0] as string;
      expect(dialogText).toContain("token regenerated");
      expect(dialogText).not.toContain(TOKEN);
    });

    it("出力チャネルにトークン失効を知らせる目立つ案内(区切り線・URL・再設定手順)を出す(トークン自体は出力しない)", async () => {
      (window.showInformationMessage as Mock).mockResolvedValue(undefined);
      const handle = makeHandle();

      await showConnectionInfo(handle, "regenerated");

      const text = loggedText();
      expect(text).toContain("regenerated");
      expect(text).toContain("401");
      expect(text).toContain(handle.url);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("Bearer");
    });

    it("reasonを省略した通常起動時は、目立つ案内を出力しない", async () => {
      (window.showInformationMessage as Mock).mockResolvedValue(undefined);

      await showConnectionInfo(makeHandle());

      const text = loggedText();
      expect(text).not.toContain("401");
      expect(text).not.toContain("regenerated");
    });
  });
});
