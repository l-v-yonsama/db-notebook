import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("common dashboard source isolation", () => {
  it("keeps provider-specific terms out of shared dashboard components", () => {
    const directory = resolve("webview-ui/src/components/observability");
    const sharedComponents = readdirSync(directory).filter((filename) =>
      /^Dashboard.*\.vue$/.test(filename)
    );

    for (const filename of sharedComponents) {
      const source = readFileSync(join(directory, filename), "utf8");
      expect(source, filename).not.toMatch(/CloudWatch|\bAWS\b|\bpg_/i);
    }
  });
});
