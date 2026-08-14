import { describe, expect, it, vi } from "vitest";
import { window } from "vscode";
import type { RunResult } from "../../src/types/Notebook";
import {
  makeCell,
  makeNotebook,
  nodeKernelFake,
  registerControllerTestHooks,
  setupController,
} from "./controllerTestSupport";

registerControllerTestHooks();

describe("MainController._interruptHandler", () => {
  it("実行中セッションが無くても例外を投げずにステータスバーへ通知する", () => {
    const { controllerObj } = setupController();
    const notebook = makeNotebook([]);

    expect(() => controllerObj.interruptHandler(notebook)).not.toThrow();
    expect(window.setStatusBarMessage).toHaveBeenCalledWith("Interrupted", 3000);
  });

  it("実行中にinterruptすると使用中のカーネルにinterrupt()が伝播する", async () => {
    const { controllerObj } = setupController();
    let resolveRun!: (r: RunResult) => void;
    const pendingRun = new Promise<RunResult>((resolve) => {
      resolveRun = resolve;
    });
    nodeKernelFake.run.mockReturnValue(pendingRun);

    const cell = makeCell({ languageId: "javascript" });
    const notebook = makeNotebook([cell]);

    const execPromise = controllerObj.executeHandler([cell], notebook, controllerObj);
    await vi.waitFor(() => expect(nodeKernelFake.run).toHaveBeenCalled());

    controllerObj.interruptHandler(notebook);
    expect(nodeKernelFake.interrupt).toHaveBeenCalled();

    resolveRun({ stdout: "", stderr: "", skipped: false, status: "executed" });
    await execPromise;
  });
});
