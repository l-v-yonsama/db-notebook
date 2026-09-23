import { createRequire } from "node:module";
import * as path from "node:path";
import type {
  LogParseConfig,
  LogParseDiagnostics,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";

const packageConsumers = [
  { name: "extension", packageJson: path.resolve(__dirname, "../../package.json") },
  { name: "webview", packageJson: path.resolve(__dirname, "../../webview-ui/package.json") },
];

describe.each(packageConsumers)("Log parser dependency contract ($name)", ({ packageJson }) => {
  const requireFromConsumer = createRequire(packageJson);
  const installedDrivers = requireFromConsumer(
    "@l-v-yonsama/multi-platform-database-drivers"
  ) as typeof import("@l-v-yonsama/multi-platform-database-drivers");

  it("reports the last executable stage when SQL extraction is not configured", () => {
    const config: LogParseConfig = {
      split: installedDrivers.LOG_EVENT_SPLIT_PRESETS.Simple.split,
      classify: [],
      extractors: [],
    };
    expect(installedDrivers.validateConfig(config)).toMatchObject({
      ok: false,
      availableStage: "split",
    });
    expect(installedDrivers.validateConfig(config, "split").ok).toBe(true);
    expect(installedDrivers.validateConfig({ ...config, split: { fields: [] } })).toMatchObject({
      ok: false,
      availableStage: undefined,
    });
  });

  it("exposes diagnostics through the public parser result", () => {
    const config: LogParseConfig = {
      split: installedDrivers.LOG_EVENT_SPLIT_PRESETS.Simple.split,
      classify: [],
      extractors: [],
    };
    const result = new installedDrivers.LogParser(config).parse({
      stage: "split",
      logText: [
        "2026-03-12 10:11:22 INFO com.example.Service - Application started",
        "2026-03-12 10:11:23 missing required fields",
      ].join("\n"),
    });
    const diagnostics: LogParseDiagnostics | undefined = result.diagnostics;
    expect(result.ok).toBe(true);
    expect(result.logEvents).toHaveLength(1);
    expect(diagnostics).toEqual({
      unmatchedEventCount: 1,
      unmatchedEventStartLines: [2],
    });
  });
});
