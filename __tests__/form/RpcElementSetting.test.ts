import { describe, expect, it } from "vitest";
import { DBType, type ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { RpcElementSetting } from "../../webview-ui/src/components/form/factories/RpcElementSetting";

const form = new RpcElementSetting();
const setting = (): ConnectionSetting => ({
  dbType: DBType.RPC, name: "local-grpc", host: "localhost", port: 50051,
  rpc: { discovery: "reflection", authentication: { type: "none" } },
});

describe("RPC definition source validation", () => {
  it("allows reflection without a proto file or include directories", () => {
    expect(form.accept(setting())).toBe(true);
  });

  it.each([undefined, "proto", "verify"] as const)("requires a local proto for %s", (discovery) => {
    const local = setting();
    local.rpc!.discovery = discovery;
    expect(form.accept(local)).toBe(false);
    local.rpc!.protoFilePath = "/project/service.proto";
    expect(form.accept(local)).toBe(true);
  });

  it("keeps host, port, and authentication validation in reflection mode", () => {
    expect(form.accept({ ...setting(), host: "" })).toBe(false);
    expect(form.accept({ ...setting(), port: 0 })).toBe(false);
    const secure = setting();
    secure.rpc!.authentication = { type: "bearer", token: "test-token" };
    expect(form.accept(secure)).toBe(false);
    secure.ssl = { use: true };
    expect(form.accept(secure)).toBe(true);
    secure.rpc!.authentication = { type: "bearer", token: "" };
    expect(form.accept(secure)).toBe(false);
  });
});
