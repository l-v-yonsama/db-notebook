import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { describe, expect, it } from "vitest";
import { prepareAiRdhPayload } from "../../src/utilities/aiRdhMasking";

function build(rows: Array<Record<string, unknown>>) {
  const builder = new ResultSetDataBuilder(Object.keys(rows[0]));
  rows.forEach((row) => builder.addRow(row));
  return builder.build();
}

describe("prepareAiRdhPayload", () => {
  it("partially masks common sensitive columns at Lv1", () => {
    const prepared = prepareAiRdhPayload(
      build([{ email: "john@example.com", phone: "090-1234-5678", display_name: "山田太郎" }]),
      { level: 1, destination: "lmTool", limit: 100 }
    );
    expect(prepared.payload).not.toContain("john@example.com");
    expect(prepared.payload).toContain("j***@e***.com");
    expect(prepared.payload).toContain("090-****-****");
    expect(prepared.payload).toContain("山***");
    expect(prepared.payload).toContain("change 'AI data masking' to 'Lv0 - No masking'");
    expect(prepared.payload).toContain("Do not suggest reading stored database credentials");
    expect(prepared.findings.every((finding) => finding.disposition === "masked")).toBe(true);
    expect(prepared.findings.map((finding) => finding.originalText)).toEqual(
      expect.arrayContaining(["john@example.com", "090-1234-5678", "山田太郎"])
    );
  });

  it("uses Japanese column comments and retains a structured country field", () => {
    const rdh = build([{ col1: "山田太郎", col2: "日本" }]);
    rdh.keys[0].comment = "氏名";
    rdh.keys[1].comment = "国";
    const prepared = prepareAiRdhPayload(rdh, {
      level: 1,
      destination: "lmTool",
      limit: 100,
    });
    expect(prepared.payload).toContain("山***");
    expect(prepared.payload).toContain("日本");
    expect(prepared.findings).toHaveLength(1);
  });

  it("keeps Japanese prefecture and municipality but masks the lower address", () => {
    const prepared = prepareAiRdhPayload(build([{ address: "東京都新宿区西新宿2-8-1" }]), {
      level: 1,
      destination: "mcp",
      limit: 100,
    });
    expect(prepared.payload).toContain("東京都新宿区***");
    expect(prepared.payload).not.toContain("西新宿2-8-1");
  });

  it("fully masks an unstructured overseas address and retains a structured country", () => {
    const prepared = prepareAiRdhPayload(
      build([{ country: "US", address_line1: "1600 Pennsylvania Avenue NW" }]),
      { level: 1, destination: "lmTool", limit: 100 }
    );
    expect(prepared.payload).toContain("US");
    expect(prepared.payload).toContain("<masked:address>");
    expect(prepared.payload).not.toContain("Pennsylvania");
  });

  it("masks every present value with a type marker at Lv2", () => {
    const prepared = prepareAiRdhPayload(
      build([{ id: 42, active: true, memo: "hello", empty: "", nullable: null }]),
      { level: 2, destination: "lmTool", limit: 100 }
    );
    expect(prepared.payload).toContain("<masked:number>");
    expect(prepared.payload).toContain("<masked:boolean>");
    expect(prepared.payload).toContain("<masked:text>");
    expect(prepared.findings).toHaveLength(3);
  });

  it("requires an explicit decision for generic payload cells at Lv1", () => {
    const rdh = build([{ payload: "ordinary application message" }]);
    const first = prepareAiRdhPayload(rdh, { level: 1, destination: "mcp", limit: 100 });
    expect(first.findings[0].disposition).toBe("unreviewed");
    const resolutions = new Map([[first.findings[0].id, { disposition: "allowed" as const }]]);
    const allowed = prepareAiRdhPayload(rdh, {
      level: 1,
      destination: "mcp",
      limit: 100,
      requestId: first.requestId,
      expiresAt: first.expiresAt,
      resolutions,
    });
    expect(allowed.findings[0].disposition).toBe("allowed");
    expect(allowed.payload).toContain("ordinary application message");
  });

  it("always masks a high-confidence secret in an otherwise ordinary column", () => {
    const key = `sk-${"a".repeat(24)}`;
    const prepared = prepareAiRdhPayload(build([{ note: key }]), {
      level: 1,
      destination: "lmTool",
      limit: 100,
    });
    expect(prepared.payload).not.toContain(key);
    expect(prepared.payload).toContain("<masked:secret>");
  });

  it("caps the final UTF-8 payload without cutting a line", () => {
    const original = "x".repeat(1024 * 1024 + 1000);
    const prepared = prepareAiRdhPayload(build([{ payload: original }]), {
      level: 1,
      destination: "mcp",
      limit: 100,
    });
    expect(Buffer.byteLength(prepared.payload, "utf8")).toBeLessThanOrEqual(1024 * 1024);
    expect(prepared.truncation?.omittedApproxBytes).toBeGreaterThan(0);
    expect(prepared.payload).not.toContain(original);
    expect(prepared.findings).toHaveLength(0);
  });
});
