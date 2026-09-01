import type { ExtensionContext, SecretStorage } from "vscode";
import { describe, expect, it } from "vitest";
import { AI_MASKING_LEVEL_BY_CONNECTION_KEY, StateStorage } from "../../src/utilities/StateStorage";

function createStorage(): {
  storage: StateStorage;
  values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  const context = {
    globalState: {
      get: <T>(key: string, defaultValue?: T): T =>
        (values.has(key) ? values.get(key) : defaultValue) as T,
      update: async (key: string, value: unknown): Promise<void> => {
        values.set(key, value);
      },
    },
  } as unknown as ExtensionContext;
  return {
    storage: new StateStorage(context, {} as SecretStorage),
    values,
  };
}

describe("StateStorage AI masking level", () => {
  it("defaults a connection without a saved level to Lv0", async () => {
    const { storage } = createStorage();
    expect(storage.getAiMaskingLevelForConnection("prod")).toBe(0);
    await storage.setAiMaskingLevelForConnection("prod", 0);
    expect(storage.getAiMaskingLevelForConnection("prod")).toBe(0);
  });

  it("stores independent overrides and removes only the requested connection", async () => {
    const { storage, values } = createStorage();
    await storage.setAiMaskingLevelForConnection("prod", 1);
    await storage.setAiMaskingLevelForConnection("dev", 2);
    await storage.setAiMaskingLevelForConnection("prod", undefined);
    expect(storage.getAiMaskingLevelForConnection("prod")).toBe(0);
    expect(storage.getAiMaskingLevelForConnection("dev")).toBe(2);
    expect(values.get(AI_MASKING_LEVEL_BY_CONNECTION_KEY)).toEqual({ dev: 2 });
  });
});
