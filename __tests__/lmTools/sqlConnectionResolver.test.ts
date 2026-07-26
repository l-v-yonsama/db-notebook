import { AwsServiceType, DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "../../src/utilities/StateStorage";
import { resolveQueryConnection, resolveSqlOnlyConnection } from "../../src/lmTools/sqlConnectionResolver";

type ConnectionFixture = { dbType: DBType; awsSetting?: { services: AwsServiceType[] } };

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

describe("resolveSqlOnlyConnection", () => {
  it("RDS接続はそのまま解決される", async () => {
    const stateStorage = makeStateStorage({ connections: { mysql1: { dbType: DBType.MySQL } } });
    const result = await resolveSqlOnlyConnection(stateStorage, "mysql1");
    expect(result.ok).toBe(true);
  });

  it("Oracle接続はRDS接続としてそのまま解決される", async () => {
    const stateStorage = makeStateStorage({ connections: { oracle1: { dbType: DBType.Oracle } } });
    const result = await resolveSqlOnlyConnection(stateStorage, "oracle1");
    expect(result.ok).toBe(true);
  });

  it("DynamoDB設定のAWS接続は拒否される(resolveQueryConnectionと違って変更していないことの回帰確認)", async () => {
    const stateStorage = makeStateStorage({
      connections: { dynamo1: { dbType: DBType.Aws, awsSetting: { services: [AwsServiceType.DynamoDB] } } },
    });
    const result = await resolveSqlOnlyConnection(stateStorage, "dynamo1");
    expect(result.ok).toBe(false);
  });
});

describe("resolveQueryConnection", () => {
  it("RDS接続はそのまま解決される", async () => {
    const stateStorage = makeStateStorage({ connections: { mysql1: { dbType: DBType.MySQL } } });
    const result = await resolveQueryConnection(stateStorage, "mysql1");
    expect(result.ok).toBe(true);
  });

  it("Oracle接続はRDS接続としてそのまま解決される", async () => {
    const stateStorage = makeStateStorage({ connections: { oracle1: { dbType: DBType.Oracle } } });
    const result = await resolveQueryConnection(stateStorage, "oracle1");
    expect(result.ok).toBe(true);
  });

  it("DynamoDB設定のAWS接続はPartiQL用に解決される", async () => {
    const stateStorage = makeStateStorage({
      connections: { dynamo1: { dbType: DBType.Aws, awsSetting: { services: [AwsServiceType.DynamoDB] } } },
    });
    const result = await resolveQueryConnection(stateStorage, "dynamo1");
    expect(result.ok).toBe(true);
  });

  it("DynamoDBを含まないAWS接続(S3のみ)は拒否される", async () => {
    const stateStorage = makeStateStorage({
      connections: { s3Only: { dbType: DBType.Aws, awsSetting: { services: [AwsServiceType.S3] } } },
    });
    const result = await resolveQueryConnection(stateStorage, "s3Only");
    expect(result.ok).toBe(false);
  });

  it("RDSでもAWSでもない接続(Redis)は拒否される", async () => {
    const stateStorage = makeStateStorage({ connections: { redis1: { dbType: DBType.Redis } } });
    const result = await resolveQueryConnection(stateStorage, "redis1");
    expect(result.ok).toBe(false);
  });
});
