import { describe, expect, it } from "vitest";
import { registerControllerTestHooks, setupController } from "./controllerTestSupport";

registerControllerTestHooks();

describe("MainController construction", () => {
  it("wires the notebook controller to _executeAll/_interruptHandler", () => {
    const { controller, controllerObj } = setupController();

    expect(controllerObj.supportedLanguages).toEqual(controller.supportedLanguages);
    expect(controllerObj.supportsExecutionOrder).toBe(true);
    expect(typeof controllerObj.executeHandler).toBe("function");
    expect(typeof controllerObj.interruptHandler).toBe("function");
  });
});
