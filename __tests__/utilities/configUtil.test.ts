import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspace } from "vscode";
import { getDatabaseConfig } from "../../src/utilities/configUtil";

const mockDatabaseConfig = (values: Record<string, unknown>) => {
  vi.mocked(workspace.getConfiguration).mockImplementation((section?: string) => {
    if (section !== "database") {
      return { get: (_key: string, defaultValue?: unknown) => defaultValue } as never;
    }
    return {
      get: (key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue),
    } as never;
  });
};

describe("getDatabaseConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("設定が未指定の場合、resourceTreeAutoExpandToはschemaになる", () => {
    mockDatabaseConfig({});

    expect(getDatabaseConfig().resourceTreeAutoExpandTo).toBe("schema");
  });

  it.each(["none", "database", "schema", "table"] as const)(
    "resourceTreeAutoExpandToに%sを指定するとそのまま読み取れる",
    (value) => {
      mockDatabaseConfig({ resourceTreeAutoExpandTo: value });

      expect(getDatabaseConfig().resourceTreeAutoExpandTo).toBe(value);
    }
  );

  it("未知の設定値はschemaにフォールバックする", () => {
    mockDatabaseConfig({ resourceTreeAutoExpandTo: "unknown-value" });

    expect(getDatabaseConfig().resourceTreeAutoExpandTo).toBe("schema");
  });
});
