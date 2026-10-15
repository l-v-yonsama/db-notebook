import { LOG_EVENT_SPLIT_PRESETS, SQL_LOG_PARSE_PRESETS } from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, workspace } from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadComparisonSettings } from "../../src/utilities/sqlLogComparison/configuration";

const settings = {
  beforeParserConfigFile: Uri.file("/workspace/old.log-parser.config.json"),
  afterParserConfigFile: Uri.file("/workspace/new.log-parser.config.json"),
  dialect: "mysql" as const,
};

beforeEach(() => vi.clearAllMocks());

describe("SQL log comparison settings", () => {
  it("loads both parser configs supplied by the panel", async () => {
    const parser = JSON.stringify({ split: LOG_EVENT_SPLIT_PRESETS.Simple.split, ...SQL_LOG_PARSE_PRESETS.S2Jdbc });
    vi.mocked(workspace.fs.readFile).mockResolvedValue(Buffer.from(parser));
    const loaded = await loadComparisonSettings(settings);
    expect(loaded.beforeParser.uri).toBe(settings.beforeParserConfigFile);
    expect(loaded.afterParser.uri).toBe(settings.afterParserConfigFile);
  });

  it("rejects parser configs that cannot extract SQL", async () => {
    vi.mocked(workspace.fs.readFile).mockResolvedValue(Buffer.from("{}"));
    await expect(loadComparisonSettings(settings)).rejects.toThrow();
  });
});
