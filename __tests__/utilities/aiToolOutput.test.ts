import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "../../src/utilities/StateStorage";
import { approveAiTextOutput, withConnectionMasking } from "../../src/utilities/aiToolOutput";

describe("AI tool output policy", () => {
  it("uses an explicit connection override, including Lv0", () => {
    const stateStorage = {
      getAiMaskingLevelForConnection: vi.fn(() => 0),
    } as unknown as StateStorage;
    expect(withConnectionMasking(stateStorage, "prod", { source: "mcp" })?.maskingLevel).toBe(0);
  });

  it("does not consult a global fallback when the connection defaults to Lv0", () => {
    const stateStorage = {
      getAiMaskingLevelForConnection: vi.fn(() => 0),
    } as unknown as StateStorage;
    expect(withConnectionMasking(stateStorage, "legacy", { source: "lmTool" })?.maskingLevel).toBe(
      0
    );
  });

  it("returns the original text without opening approval at effective Lv0", async () => {
    const stateStorage = {
      getAiMaskingLevelForConnection: vi.fn(() => 0),
    } as unknown as StateStorage;
    const raw = "CREATE TABLE t (name text DEFAULT 'Alice')";
    await expect(
      approveAiTextOutput(raw, stateStorage, "dev", { source: "lmTool" }, "definition")
    ).resolves.toBe(raw);
  });
});
