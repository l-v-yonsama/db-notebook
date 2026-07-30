import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import { getOrCreateToken, regenerateToken } from "../../src/mcpServer/auth";

const makeContext = (overrides: Partial<ExtensionContext["secrets"]> = {}): ExtensionContext =>
  ({
    secrets: {
      get: vi.fn(async () => undefined),
      store: vi.fn(async () => undefined),
      ...overrides,
    },
  } as unknown as ExtensionContext);

describe("getOrCreateToken", () => {
  it("既存トークンがあればそれを返し、storeは呼ばない", async () => {
    const context = makeContext({ get: vi.fn(async () => "existing-token") });

    const token = await getOrCreateToken(context);

    expect(token).toBe("existing-token");
    expect(context.secrets.store).not.toHaveBeenCalled();
  });

  it("既存トークンが無ければ新規生成してstoreする", async () => {
    const context = makeContext();

    const token = await getOrCreateToken(context);

    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(context.secrets.store).toHaveBeenCalledWith("databaseNotebook.mcpServerToken", token);
  });
});

describe("SecretStorageのタイムアウト保護", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("secrets.getが応答しない場合、無限に待たずタイムアウトエラーになる", async () => {
    const context = makeContext({ get: () => new Promise(() => {}) });

    const promise = getOrCreateToken(context);
    const assertion = expect(promise).rejects.toThrow(/Timed out waiting for VS Code's secure storage/);

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("secrets.storeが応答しない場合も、無限に待たずタイムアウトエラーになる", async () => {
    const context = makeContext({
      get: vi.fn(async () => undefined),
      store: () => new Promise(() => {}),
    });

    const promise = getOrCreateToken(context);
    const assertion = expect(promise).rejects.toThrow(/Timed out waiting for VS Code's secure storage/);

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("regenerateTokenもsecrets.storeがハングすればタイムアウトする", async () => {
    const context = makeContext({ store: () => new Promise(() => {}) });

    const promise = regenerateToken(context);
    const assertion = expect(promise).rejects.toThrow(/Timed out waiting for VS Code's secure storage/);

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
