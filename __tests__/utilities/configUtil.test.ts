import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspace } from "vscode";
import { getDatabaseConfig, getOutputConfig } from "../../src/utilities/configUtil";

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

describe("getOutputConfig Excel theme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未指定なら従来スタイルを選び、設定値と未知の値を正規化する", () => {
    const getConfiguration = vi.mocked(workspace.getConfiguration);
    const original = getConfiguration.getMockImplementation()!;
    const mockTheme = (value: unknown) => {
      getConfiguration.mockImplementation((section?: string) => ({
        get: (key: string, defaultValue?: unknown) =>
          section === "output" && key === "Excel: Theme" ? value : defaultValue,
      }) as never);
    };

    try {
      mockTheme(undefined);
      expect(getOutputConfig().excel.theme).toBe("unspecified");
      mockTheme("chalkboard");
      expect(getOutputConfig().excel.theme).toBe("chalkboard");
      mockTheme("unknown");
      expect(getOutputConfig().excel.theme).toBe("unspecified");
    } finally {
      getConfiguration.mockImplementation(original);
    }
  });
});
