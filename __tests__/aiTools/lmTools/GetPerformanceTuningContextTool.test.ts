import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "../../../src/utilities/StateStorage";
import {
  formatPerformanceTuningContextResultForModel,
  getPerformanceTuningContextText,
} from "../../../src/aiTools/lmTools/GetPerformanceTuningContextTool";

type ConnectionFixture = { dbType?: string; database?: string };

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

describe("formatPerformanceTuningContextResultForModel", () => {
  it("returns the context JSON verbatim on success", () => {
    const context = { formatVersion: 1, database: { vendor: "postgresql", databaseName: "app" } } as any;
    const text = formatPerformanceTuningContextResultForModel({ ok: true, context });
    expect(JSON.parse(text)).toEqual(context);
  });

  it("prefixes an error result with ❌ and lists available connections when given", () => {
    const text = formatPerformanceTuningContextResultForModel({
      ok: false,
      message: "No connection named \"typo\" was found.",
      availableConnectionNames: ["localMySQL", "prodPg"],
    });
    expect(text).toContain("❌ No connection named \"typo\" was found.");
    expect(text).toContain("Available connections: localMySQL, prodPg");
  });

  it("omits the available-connections line when none were given", () => {
    const text = formatPerformanceTuningContextResultForModel({ ok: false, message: "boom" });
    expect(text).toBe("❌ boom");
  });
});

describe("getPerformanceTuningContextText", () => {
  it("rejects an empty sql before touching the connection", async () => {
    const stateStorage = makeStateStorage({ connections: { localMySQL: {} } });
    const text = await getPerformanceTuningContextText(stateStorage, {
      connectionName: "localMySQL",
      sql: "   ",
    });
    expect(text).toBe("❌ sql must not be empty.");
    expect(stateStorage.getConnectionSettingByName).not.toHaveBeenCalled();
  });

  it("reports an unknown/not-mcp-enabled connection the same way other AI tools do", async () => {
    const stateStorage = makeStateStorage({ connections: {}, mcpEnabled: [] });
    const text = await getPerformanceTuningContextText(stateStorage, {
      connectionName: "doesNotExist",
      sql: "SELECT 1",
    });
    expect(text).toContain("❌");
    expect(text).toContain("doesNotExist");
  });

  it("requires an explicit databaseName when the connection has no default database configured", async () => {
    const stateStorage = makeStateStorage({
      connections: { localMySQL: { dbType: "mysql" } },
    });
    const text = await getPerformanceTuningContextText(stateStorage, {
      connectionName: "localMySQL",
      sql: "SELECT 1",
    });
    expect(text).toContain("❌");
    expect(text).toContain("no default database configured");
    expect(text).toContain("databaseName must be provided explicitly");
  });

  // An "Aws" connection never needs databaseName - the RDB-only check above
  // must not apply to it. See GetPerformanceTuningContextTool.ts's own
  // dbType branch (fetchDynamoDbPerformanceTuningContext()). This fixture's
  // Aws connection has no awsSetting at all, so
  // createSQLSupportDriver()/isPartiQLType() (db-drivers'
  // DBDriverResolver.ts/dbType.ts) correctly reject it before this tool's
  // own DynamoDB-availability check ever runs - a real, properly-configured
  // DynamoDB connection (awsSetting.services including 'DynamoDB') passes
  // that gate and reaches supportsGetDynamoDbPerformanceTuningContext()
  // instead; this test only needs to prove the RDB branch (and its
  // databaseName requirement) was never taken for an Aws connection.
  it("skips the RDB-only databaseName requirement for an Aws connection", async () => {
    const stateStorage = makeStateStorage({
      connections: { awsConn: { dbType: "Aws" } },
    });
    const text = await getPerformanceTuningContextText(stateStorage, {
      connectionName: "awsConn",
      sql: "SELECT * FROM orders WHERE pk = 'tenant#42'",
    });
    expect(text).toContain("❌");
    expect(text).not.toContain("no default database configured");
    expect(text).not.toContain("databaseName must be provided explicitly");
    expect(text).toContain("Aws is not support sql");
  });
});
