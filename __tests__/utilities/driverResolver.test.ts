import {
  DBDriverResolver,
  DBType,
  SQLServerAuthenticationType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  BaseDriver,
  ConnectionSetting,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utilities/EntraIdAuth", () => ({
  acquireEntraIdAccessToken: vi.fn(),
}));

import { acquireEntraIdAccessToken } from "../../src/utilities/EntraIdAuth";
import { createDriver } from "../../src/utilities/driverResolver";

const acquireToken = vi.mocked(acquireEntraIdAccessToken);
const createdDriver = {} as BaseDriver;
const createDriverMock = vi.fn(() => createdDriver);

const entraSetting = (): ConnectionSetting => ({
  dbType: DBType.SQLServer,
  name: "entra-sql",
  host: "example.database.windows.net",
  database: "example-db",
  sqlServer: {
    authenticationType: SQLServerAuthenticationType.azureActiveDirectoryAccessToken,
    tenantId: "tenant-id",
  },
});

describe("driverResolver Entra ID token resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(DBDriverResolver, "getInstance").mockReturnValue({
      createDriver: createDriverMock,
    } as unknown as DBDriverResolver);
  });

  it("取得したトークンをSQL Server設定へ注入してドライバーを生成する", async () => {
    acquireToken.mockResolvedValue("access-token");
    const setting = entraSetting();

    await expect(createDriver(setting, true)).resolves.toBe(createdDriver);

    expect(acquireToken).toHaveBeenCalledWith({ interactive: true, tenantId: "tenant-id" });
    expect(createDriverMock).toHaveBeenCalledWith({
      ...setting,
      sqlServer: { ...setting.sqlServer, token: "access-token" },
    });
    expect(setting.sqlServer?.token).toBeUndefined();
  });

  it("非対話認証でトークンがなければ元の設定を変更せずに渡す", async () => {
    acquireToken.mockResolvedValue(undefined);
    const setting = entraSetting();

    await createDriver(setting, false);

    expect(acquireToken).toHaveBeenCalledWith({ interactive: false, tenantId: "tenant-id" });
    expect(createDriverMock).toHaveBeenCalledWith(setting);
  });

  it("Entraアクセストークン方式以外では認証APIを呼ばない", async () => {
    const setting: ConnectionSetting = {
      dbType: DBType.SQLServer,
      name: "sql-auth",
      host: "localhost",
      database: "master",
      user: "sa",
      password: "password",
      sqlServer: { authenticationType: SQLServerAuthenticationType.default },
    };

    await createDriver(setting, true);

    expect(acquireToken).not.toHaveBeenCalled();
    expect(createDriverMock).toHaveBeenCalledWith(setting);
  });
});
