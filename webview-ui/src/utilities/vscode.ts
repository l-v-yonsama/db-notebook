import type { WebviewApi } from "vscode-webview";
import type { ActionCommand } from "../../../src/shared/ActionParams";

export * from "../../../src/shared/ActionParams";
export * from "../../../src/shared/CodeResolverParams";
export * from "../../../src/shared/ComponentName";
export * from "../../../src/shared/CreateScriptConditionParams";
export * from "../../../src/shared/DynamoDBConditionParams";
export * from "../../../src/shared/ExtChartJs";
export * from "../../../src/shared/MessageEventData";
export * from "../../../src/shared/ModeType";
export * from "../../../src/shared/RecordRule";
export * from "../../../src/shared/RunResultMetadata";
export * from "../../../src/shared/SaveValuesInRdhParams";
export * from "../../../src/shared/ViewConditionParams";

class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<unknown> | undefined;

  constructor() {
    // Check if the acquireVsCodeApi function exists in the current development
    // context (i.e. VS Code development window or web browser)
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  /**
   * Post a message (i.e. send arbitrary data) to the owner of the webview.
   *
   * @remarks When running webview code inside a web browser, postMessage will instead
   * log the given message to the console.
   *
   * @param message Abitrary data (must be JSON serializable) to send to the extension context.
   */
  public postMessage(message: unknown) {
    if (this.vsCodeApi) {
      console.log("postMessage", JSON.stringify(message));
      this.vsCodeApi.postMessage(message);
    } else {
      console.log(message);
    }
  }

  public postCommand(command: ActionCommand) {
    this.postMessage(command);
  }

  /**
   * Get the persistent state stored for this webview.
   *
   * @remarks When running webview source code inside a web browser, getState will retrieve state
   * from local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
   *
   * @return The current state or `undefined` if no state has been set.
   */
  public getState(): unknown | undefined {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState();
    } else {
      const state = localStorage.getItem("vscodeState");
      return state ? JSON.parse(state) : undefined;
    }
  }

  /**
   * Set the persistent state stored for this webview.
   *
   * @remarks When running webview source code inside a web browser, setState will set the given
   * state using local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
   *
   * @param newState New persisted state. This must be a JSON serializable object. Can be retrieved
   * using {@link getState}.
   *
   * @return The new state.
   */
  public setState<T extends unknown | undefined>(newState: T): T {
    if (this.vsCodeApi) {
      return this.vsCodeApi.setState(newState);
    } else {
      localStorage.setItem("vscodeState", JSON.stringify(newState));
      return newState;
    }
  }
}

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscode = new VSCodeAPIWrapper();
