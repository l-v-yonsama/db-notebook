import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { describe, expect, it } from "vitest";
import type { Mock } from "vitest";
import { commands, workspace } from "vscode";
import { OPEN_CHARTS_VIEWER, REFRESH_QUERY_HISTORIES } from "../../src/constant";
import type { RunResult } from "../../src/types/Notebook";
import {
  lastExecution,
  makeCell,
  makeNotebook,
  nodeKernelFake,
  registerControllerTestHooks,
  setupController,
  shellKernelRunMock,
  sqlKernelRunMock,
} from "./controllerTestSupport";

registerControllerTestHooks();

describe("MainController.execute -> _doExecution", () => {
  it("SQLのSELECT結果からrdh markdown出力を作り、chart設定があればビューアを開く", async () => {
    const { controllerObj, stateStorage } = setupController();
    (stateStorage.getDBTypeByConnectionName as Mock).mockReturnValue(DBType.Postgres);

    const rdh = ResultSetDataBuilder.createEmpty().build();
    rdh.meta.type = "select";
    rdh.summary = { info: "1 rows" } as any;
    sqlKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
      metadata: { rdh },
    } as RunResult);

    const cell = makeCell({
      languageId: "sql",
      metadata: {
        connectionName: "conn1",
        chart: { title: "t" } as any,
      },
    });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.outputs[0].items[0].data).toContain("[Query Result]");
    expect(execution.outputs[0].items[0].data).toContain("1 rows");
    expect(execution.endedAt.success).toBe(true);

    expect(commands.executeCommand).toHaveBeenCalledWith(
      OPEN_CHARTS_VIEWER,
      expect.objectContaining({ rdh })
    );
    expect(stateStorage.addQueryHistory).toHaveBeenCalledWith(
      expect.objectContaining({ connectionName: "conn1" })
    );
    expect(stateStorage.addQueryHistory).not.toHaveBeenCalledWith(
      expect.objectContaining({ sqlMode: expect.anything() })
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(REFRESH_QUERY_HISTORIES);
  });

  it("DynamoDB風のRdhSummary.infoもrdh markdown出力にそのまま表示される（db-notebookはinfoを加工しない）", async () => {
    const { controllerObj, stateStorage } = setupController();
    (stateStorage.getDBTypeByConnectionName as Mock).mockReturnValue(DBType.Postgres);

    const rdh = ResultSetDataBuilder.createEmpty().build();
    rdh.meta.type = "select";
    // A DynamoDB-specific display string (design doc
    // misc/specs/dynamodb-rdh-summary-display-improvement-plan.ja.md §8.1):
    // db-notebook must not add DynamoDB/RDB branching of its own - whatever
    // RdhSummary.info holds is shown verbatim, item wording and all.
    rdh.summary = {
      info: "38 items returned • 90 ms • Capacity not reported",
    } as any;
    sqlKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
      metadata: { rdh },
    } as RunResult);

    const cell = makeCell({
      languageId: "sql",
      metadata: { connectionName: "conn1" },
    });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.outputs[0].items[0].data).toContain(
      "38 items returned • 90 ms • Capacity not reported"
    );
  });

  it.each(["Explain", "ExplainAnalyze"] as const)(
    "%s実行はQuery Historyへ追加しない",
    async (sqlMode) => {
      const { controller, controllerObj, stateStorage } = setupController();
      (stateStorage.getDBTypeByConnectionName as Mock).mockReturnValue(DBType.Postgres);

      const planRdh = ResultSetDataBuilder.createEmpty().build();
      planRdh.meta.type = sqlMode === "Explain" ? "explain" : "analyze";
      sqlKernelRunMock.mockResolvedValue({
        stdout: "",
        stderr: "",
        skipped: false,
        status: "executed",
        metadata: sqlMode === "Explain" ? { explainRdh: planRdh } : { analyzedRdh: planRdh },
      } as RunResult);

      const cell = makeCell({
        languageId: "sql",
        metadata: { connectionName: "conn1" },
        text: "select * from t",
      });
      makeNotebook([cell]);
      controller.setSqlMode(sqlMode);

      await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

      expect(stateStorage.addQueryHistory).not.toHaveBeenCalled();
      expect(commands.executeCommand).not.toHaveBeenCalledWith(REFRESH_QUERY_HISTORIES);
    }
  );

  it("stderrが返るとstderr出力を積んで失敗として終了する", async () => {
    const { controllerObj } = setupController();
    sqlKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "boom",
      skipped: false,
      status: "error",
    } as RunResult);

    const cell = makeCell({ languageId: "sql", metadata: { connectionName: "conn1" } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    const stderrItem = execution.outputs.find(
      (o: any) => o.items[0].mime === "application/vnd.code.notebook.stderr"
    );
    expect(stderrItem.items[0].data).toBe("boom");
    expect(execution.endedAt.success).toBe(false);
  });

  it("stderrが空でもstatus=errorなら失敗として終了する(exit codeベースのShellKernelの回帰テスト)", async () => {
    const { controllerObj } = setupController();
    shellKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "error",
    } as RunResult);

    const cell = makeCell({ languageId: "shellscript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.endedAt.success).toBe(false);
  });

  it("stderrがあってもstatus=executedなら成功として終了する(exit codeベースのShellKernelの回帰テスト)", async () => {
    const { controllerObj } = setupController();
    shellKernelRunMock.mockResolvedValue({
      stdout: "",
      stderr: "warning",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({ languageId: "shellscript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    const stderrItem = execution.outputs.find(
      (o: any) => o.items[0].mime === "application/vnd.code.notebook.stderr"
    );
    expect(stderrItem.items[0].data).toBe("warning");
    expect(execution.endedAt.success).toBe(true);
  });

  it("markAsSkipのセルはカーネルを呼ばずにSKIPPED出力を積む", async () => {
    const { controllerObj } = setupController();
    const cell = makeCell({ languageId: "sql", metadata: { markAsSkip: true } });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.outputs.some((o: any) => o.items[0].data === "### `SKIPPED!`")).toBe(true);
    expect(sqlKernelRunMock).not.toHaveBeenCalled();
    expect(execution.endedAt.success).toBe(true);
  });

  it("run()が例外を投げた場合はcatchされエラー出力を積んで失敗として終了する", async () => {
    const { controllerObj } = setupController();
    nodeKernelFake.run.mockRejectedValue(new Error("boom"));

    const cell = makeCell({ languageId: "javascript" });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    const execution = lastExecution(controllerObj);
    expect(execution.outputs[0].items[0].data).toBe("boom");
    expect(execution.endedAt.success).toBe(false);
  });

  it("savingSharedVariablesが指定されていれば共有変数を更新する", async () => {
    const { controllerObj } = setupController();
    nodeKernelFake.run.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      skipped: false,
      status: "executed",
    } as RunResult);

    const cell = makeCell({
      languageId: "javascript",
      metadata: { savingSharedVariables: true, sharedVariableName: "myVar" },
    });
    makeNotebook([cell]);

    await controllerObj.executeHandler([cell], cell.notebook, controllerObj);

    expect(nodeKernelFake.updateVariable).toHaveBeenCalledWith(
      "myVar",
      expect.objectContaining({ success: true, stdout: "ok", status: "executed" })
    );
  });

  it("updateJSONCellValuesで対象のJSONセルにマージ結果を書き戻す", async () => {
    const { controllerObj } = setupController();
    nodeKernelFake.run.mockResolvedValue({
      stdout: "",
      stderr: "",
      skipped: false,
      status: "executed",
      metadata: {
        updateJSONCellValues: [{ cellIndex: 0, replaceAll: false, data: { a: 1 } }],
      },
    } as RunResult);

    const jsonCell = makeCell({
      languageId: "json",
      metadata: { markAsRunInOrderAtJsonCell: true },
      text: '{"a":0,"b":2}',
    });
    const execCell = makeCell({ languageId: "javascript" });
    const notebook = makeNotebook([jsonCell, execCell]);

    await controllerObj.executeHandler([execCell], notebook, controllerObj);

    expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
    const editArg = (workspace.applyEdit as Mock).mock.calls[0][0];
    const edits = editArg.get((jsonCell.document as unknown as { uri: unknown }).uri);
    expect(edits[0].newText).toContain('"a": 1');
    expect(edits[0].newText).toContain('"b": 2');
  });
});
