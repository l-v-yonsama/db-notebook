// Covers pure extraction; the dialog and file read are thin wrappers.

import { describe, expect, it } from "vitest";
import {
  BASELINE_CONTEXT_CELL_LABELS,
  extractBaselineContext,
} from "../../src/utilities/performanceTuningBaselineLoader";
import {
  dbnFileText,
  dynamoContext,
  rdbContext,
} from "./performanceTuningComparisonFixtures";

const json = (value: unknown) => JSON.stringify(value, null, 2);

describe("extractBaselineContext", () => {
  it("extracts an RDB context from a report saved before this feature existed", () => {
    const result = extractBaselineContext(
      dbnFileText([
        { kind: 1, value: "## 1. Overview" },
        { label: "Full context JSON", value: json(rdbContext()) },
        { label: "AI analysis JSON", value: json({ formatVersion: 1, summary: "irrelevant" }) },
      ])
    );

    expect(result.ok).toBe(true);
    expect(result.ok && "database" in result.context && result.context.database.vendor).toBe(
      "PostgreSQL"
    );
  });

  it("extracts a DynamoDB context", () => {
    const result = extractBaselineContext(
      dbnFileText([{ label: "Full context JSON", value: json(dynamoContext()) }])
    );

    expect(result.ok).toBe(true);
    expect(result.ok && "engine" in result.context && result.context.engine).toBe("dynamodb");
  });

  it("prefers the Current context when a report already carries a comparison", () => {
    const older = rdbContext();
    const newer = rdbContext({
      collection: {
        collectedAt: "2026-08-20T00:00:00.000Z",
        status: "complete",
        diagnostics: [],
        unavailableSections: [],
      },
    });
    const result = extractBaselineContext(
      dbnFileText([
        { label: "Baseline Full context JSON", value: json(older) },
        { label: "Current Full context JSON", value: json(newer) },
        { label: "Full context JSON", value: json(older) },
      ])
    );

    expect(result.ok && result.context.collection.collectedAt).toBe("2026-08-20T00:00:00.000Z");
  });

  it("lists the labels it looks for in priority order", () => {
    expect([...BASELINE_CONTEXT_CELL_LABELS]).toEqual([
      "Current Full context JSON",
      "Full context JSON",
    ]);
  });

  it("rejects a file that is not JSON at all", () => {
    const result = extractBaselineContext("not a notebook");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("could not be parsed");
  });

  it("rejects a notebook with no context cell", () => {
    const result = extractBaselineContext(
      dbnFileText([{ kind: 1, value: "## Just some notes" }])
    );

    expect(result.ok === false && result.message).toContain("no Full context JSON cell");
  });

  it("names the problem when the file only holds another report's baseline", () => {
    const result = extractBaselineContext(
      dbnFileText([{ label: "Baseline Full context JSON", value: json(rdbContext()) }])
    );

    expect(result.ok === false && result.message).toContain("another report's baseline");
  });

  it("refuses to guess when two cells share the same context label", () => {
    const result = extractBaselineContext(
      dbnFileText([
        { label: "Full context JSON", value: json(rdbContext()) },
        { label: "Full context JSON", value: json(rdbContext()) },
      ])
    );

    expect(result.ok === false && result.message).toContain("no single context");
  });

  it("rejects a context cell whose JSON is broken", () => {
    const result = extractBaselineContext(
      dbnFileText([{ label: "Full context JSON", value: "{ oops" }])
    );

    expect(result.ok === false && result.message).toContain("does not contain valid JSON");
  });

  it("rejects an unknown format version rather than reading it optimistically", () => {
    const result = extractBaselineContext(
      dbnFileText([
        { label: "Full context JSON", value: json({ ...rdbContext(), formatVersion: 2 }) },
      ])
    );

    expect(result.ok === false && result.message).toContain("format version 2");
  });

  it("rejects a context that fails the driver's own validator", () => {
    const broken = rdbContext();
    const result = extractBaselineContext(
      dbnFileText([
        {
          label: "Full context JSON",
          value: json({ ...broken, database: undefined, statement: undefined }),
        },
      ])
    );

    expect(result.ok === false && result.message).toContain("failed validation");
  });

  it("never reads AI analysis text as a comparison fact", () => {
    const result = extractBaselineContext(
      dbnFileText([
        { label: "AI analysis JSON", value: json({ summary: "this query is fine" }) },
        { label: "Full context JSON", value: json(rdbContext()) },
      ])
    );

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("this query is fine");
  });
});
