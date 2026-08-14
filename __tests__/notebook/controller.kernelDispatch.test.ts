import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import type { Mock } from "vitest";
import type { RunResult } from "../../src/types/Notebook";
import {
  awsKernelRunMock,
  jsonKernelRunMock,
  makeCell,
  makeNotebook,
  memcachedKernelRunMock,
  mqttKernelRequestSqlMock,
  mqttKernelRunMock,
  nodeKernelFake,
  redisKernelRunMock,
  registerControllerTestHooks,
  setupController,
  shellKernelRunMock,
  sqlKernelRunMock,
} from "./controllerTestSupport";

registerControllerTestHooks();

describe("MainController.execute -> run() dispatch", () => {
  it("MQTT接続のSQLセルはmqttKernel.requestSqlへ委譲する", async () => {
    const { controllerObj, stateStorage } = setupController();
    (stateStorage.getDBTypeByConnectionName as Mock).mockReturnValue(DBType.Mqtt);
    mqttKernelRequestSqlMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "sql", metadata: { connectionName: "conn1" } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(mqttKernelRequestSqlMock).toHaveBeenCalled();
    expect(sqlKernelRunMock).not.toHaveBeenCalled();
  });

  it("cwqlセルはawsKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    awsKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "cwql" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(awsKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("memcachedセルはmemcachedKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    memcachedKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "memcached" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(memcachedKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("redisセルはredisKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    redisKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "redis" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(redisKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("shellscriptセルはshellKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    shellKernelRunMock.mockResolvedValue({
      stdout: "hello\n",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "shellscript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(shellKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("batセルもshellKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    shellKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "bat" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(shellKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("publishParams付きセルはmqttKernel.runへ委譲する", async () => {
    const { controllerObj } = setupController();
    mqttKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "json", metadata: { publishParams: {} as any } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(mqttKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake.getStoredVariables());
  });

  it("publishParamsの無いJSONセルはjsonKernelRunへ委譲する", async () => {
    const { controllerObj } = setupController();
    jsonKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "json" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(jsonKernelRunMock).toHaveBeenCalledWith(cell, nodeKernelFake);
  });

  it("それ以外の言語(javascript)はNodeKernel.runへフォールバックする", async () => {
    const { controllerObj } = setupController();

    const cell = makeCell({ languageId: "javascript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(nodeKernelFake.run).toHaveBeenCalledWith(cell);
  });

  it("それ以外の言語(typescript)もNodeKernel.runへフォールバックする", async () => {
    const { controllerObj } = setupController();

    const cell = makeCell({ languageId: "typescript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(nodeKernelFake.run).toHaveBeenCalledWith(cell);
  });
});
