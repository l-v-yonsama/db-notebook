import {
  LOG_EVENT_SPLIT_PRESETS,
  SQL_LOG_PARSE_PRESETS,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  formatLogParseDiagnostics,
  getLogParseNextAction,
} from "../../src/shared/LogParseWorkflow";
import { readLogParseConfiguration } from "../../src/utilities/logParseConfiguration";

const config = {
  split: LOG_EVENT_SPLIT_PRESETS.Simple.split,
  ...SQL_LOG_PARSE_PRESETS.MyBatis,
};

describe("Log parse workflow", () => {
  it("distinguishes missing, empty and unreadable configs", () => {
    const nextAction = (text?: string) =>
      getLogParseNextAction({
        revision: 1,
        ...readLogParseConfiguration(text),
      });
    expect(nextAction()).toBe("select-config");
    expect(
      nextAction(JSON.stringify({ split: { fields: [] }, classify: [], extractors: [] }))
    ).toBe("select-split");
    for (const text of ["{", "null", '{"split":{}}']) {
      expect(nextAction(text)).toBe("edit-config");
      expect(readLogParseConfiguration(text).configuration.canParse).toBe(false);
    }
  });

  it("allows split testing before extraction is configured and preserves the config summary", () => {
    const state = readLogParseConfiguration(JSON.stringify({ ...config, extractors: [] }));
    expect(state.configuration).toMatchObject({ canSplit: true, canParse: false });
    expect(state.configSummary.classificationSummary).not.toBe("");
    expect(getLogParseNextAction({ revision: 1, ...state })).toBe("select-sql");
    expect(getLogParseNextAction({ revision: 1, ...state })).toBe("select-sql");
    const complete = readLogParseConfiguration(JSON.stringify(config));
    expect(getLogParseNextAction({ revision: 1, ...complete })).toBe("parse");
    expect(complete.configuration.availableStage).toBe("sqlExecution");
  });

  it("keeps malformed fields from enabling parsing or breaking configuration refresh", () => {
    for (const fields of [
      [null],
      [{ name: "message", type: "regex", pattern: "(", eventStartMarker: true }],
    ]) {
      const state = readLogParseConfiguration(JSON.stringify({ ...config, split: { fields } }));
      expect(state.configuration).toMatchObject({ canSplit: false, canParse: false });
      expect(state.configuration.splitError).not.toBe("");
    }
  });

  it("distinguishes missing diagnostics, no failures and a bounded set of positions", () => {
    expect(formatLogParseDiagnostics()).toContain("unavailable");
    expect(
      formatLogParseDiagnostics({ unmatchedEventCount: 0, unmatchedEventStartLines: [] })
    ).toBe("");
    expect(
      formatLogParseDiagnostics({ unmatchedEventCount: 1, unmatchedEventStartLines: [7] })
    ).toContain("Start lines: 7");
    expect(
      formatLogParseDiagnostics({
        unmatchedEventCount: 25,
        unmatchedEventStartLines: Array.from({ length: 20 }, (_, i) => i + 1),
      })
    ).toContain("25 log events did not match the field pattern. First 20 start lines:");
  });
});
