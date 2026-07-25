import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "../utilities/StateStorage";
import { resolveMcpEnabledConnection, suggestConnectionNames } from "./mcpAccessControl";

type ConnectionFixture = Record<string, never>;

const makeStateStorage = (
  opts: {
    connections?: Record<string, ConnectionFixture>;
    mcpEnabled?: string[];
  } = {}
): StateStorage => {
  const connections = opts.connections ?? {};
  const mcpEnabled = new Set(opts.mcpEnabled ?? Object.keys(connections));
  return {
    getConnectionSettingByName: vi.fn(async (name: string) => connections[name]),
    getConnectionSettingNames: vi.fn(() => Object.keys(connections)),
    isMcpEnabledForConnection: vi.fn((name: string) => mcpEnabled.has(name)),
  } as unknown as StateStorage;
};

describe("resolveMcpEnabledConnection", () => {
  it("完全一致する接続はそのまま解決される", async () => {
    const stateStorage = makeStateStorage({ connections: { localMySQL: {} } });
    const result = await resolveMcpEnabledConnection(stateStorage, "localMySQL");
    expect(result.ok).toBe(true);
  });

  it("大文字小文字だけ違う場合はDid you meanヒントが付く", async () => {
    const stateStorage = makeStateStorage({ connections: { localMySQL: {} } });
    const result = await resolveMcpEnabledConnection(stateStorage, "localMysql");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Did you mean "localMySQL"\?/);
    }
  });

  it("1文字違いのtypoでもヒントが付く", async () => {
    const stateStorage = makeStateStorage({ connections: { Analytics: {} } });
    const result = await resolveMcpEnabledConnection(stateStorage, "Analitics");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Did you mean "Analytics"\?/);
    }
  });

  it("似ていない名前の場合はヒントを付けない", async () => {
    const stateStorage = makeStateStorage({ connections: { Analytics: {} } });
    const result = await resolveMcpEnabledConnection(stateStorage, "totallyDifferentName");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/Did you mean/);
    }
  });

  it("有効な接続が1つも無い場合はヒントを付けない", async () => {
    const stateStorage = makeStateStorage();
    const result = await resolveMcpEnabledConnection(stateStorage, "anything");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/Did you mean/);
    }
  });

  it("極端に短い入力はヒントを付けない", async () => {
    const stateStorage = makeStateStorage({ connections: { localMySQL: {} } });
    const result = await resolveMcpEnabledConnection(stateStorage, "a");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/Did you mean/);
    }
  });

  it("mcpEnabledでない接続に近い名前を入れてもヒントに出さない(オプトイン漏洩防止)", async () => {
    const stateStorage = makeStateStorage({
      connections: { Production: {}, Staging: {} },
      mcpEnabled: ["Staging"],
    });
    const result = await resolveMcpEnabledConnection(stateStorage, "Producton");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("Production");
      expect(result.message).not.toMatch(/Did you mean/);
    }
  });

  it("同距離の候補が2つある場合は両方をorで繋いで提示する", async () => {
    const stateStorage = makeStateStorage({ connections: { DevA: {}, DevB: {} } });
    const result = await resolveMcpEnabledConnection(stateStorage, "DevC");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Did you mean "DevA" or "DevB"\?/);
    }
  });

  it("同距離の候補が3つある場合は先頭2件のみ提示する", async () => {
    const stateStorage = makeStateStorage({ connections: { DevA: {}, DevB: {}, DevD: {} } });
    const result = await resolveMcpEnabledConnection(stateStorage, "DevC");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/Did you mean "DevA" or "DevB"\?/);
      expect(result.message).not.toContain("DevD");
    }
  });
});

describe("suggestConnectionNames", () => {
  it("空文字列の入力は候補を返さない", () => {
    expect(suggestConnectionNames("", ["localMySQL"])).toEqual([]);
  });

  it("候補が空配列なら何も返さない", () => {
    expect(suggestConnectionNames("localMysql", [])).toEqual([]);
  });
});
