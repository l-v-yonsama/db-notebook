import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { authentication } from "vscode";
import { acquireEntraIdAccessToken } from "../../src/utilities/EntraIdAuth";

const getSession = authentication.getSession as Mock;

describe("acquireEntraIdAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("対話認証ではSQL Databaseのスコープでセッションを作成し、アクセストークンを返す", async () => {
    getSession.mockResolvedValue({ accessToken: "access-token" });

    await expect(acquireEntraIdAccessToken()).resolves.toBe("access-token");
    expect(getSession).toHaveBeenCalledWith(
      "microsoft",
      ["https://database.windows.net/.default"],
      { createIfNone: true }
    );
  });

  it("Tenant IDをVS Codeのテナントスコープとして渡す", async () => {
    getSession.mockResolvedValue({ accessToken: "tenant-token" });

    await expect(
      acquireEntraIdAccessToken({ tenantId: "tenant-id", interactive: false })
    ).resolves.toBe("tenant-token");
    expect(getSession).toHaveBeenCalledWith(
      "microsoft",
      ["https://database.windows.net/.default", "VSCODE_TENANT:tenant-id"],
      { createIfNone: false }
    );
  });

  it("非対話認証でキャッシュ済みセッションがなければundefinedを返す", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(acquireEntraIdAccessToken({ interactive: false })).resolves.toBeUndefined();
  });

  it("対話認証がキャンセルされた場合は明示的なエラーにする", async () => {
    getSession.mockResolvedValue(undefined);

    await expect(acquireEntraIdAccessToken({ interactive: true })).rejects.toThrow(
      "Entra ID sign-in was cancelled or failed."
    );
  });
});
