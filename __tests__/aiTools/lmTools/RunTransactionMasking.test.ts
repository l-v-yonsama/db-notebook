import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { describe, expect, it } from "vitest";
import {
  prepareTransactionPayload,
  type TransactionRunResult,
} from "../../../src/aiTools/lmTools/RunTransactionTool";

describe("prepareTransactionPayload", () => {
  it("combines masked rows and SQL candidates into the exact final payload", () => {
    const builder = new ResultSetDataBuilder(["email"]);
    builder.addRow({ email: "bob@example.com" });
    const result: TransactionRunResult = {
      ok: true,
      message: "",
      completed: [
        {
          sql: "SELECT * FROM users WHERE email = 'alice@example.com'",
          rdh: builder.build(),
        },
      ],
    };
    const identity = { requestId: "request-1", expiresAt: Date.now() + 60_000 };
    const initial = prepareTransactionPayload(
      result,
      1,
      ["success"],
      1,
      "lmTool",
      new Map(),
      identity
    );
    expect(initial.payload).toContain("alice@example.com");
    expect(initial.payload).not.toContain("bob@example.com");
    expect(initial.payload).toContain("b***@e***.com");
    expect(initial.payload).toContain("change 'AI data masking' to 'Lv0 - No masking'");
    expect(initial.payload).toContain("Do not suggest reading stored database credentials");
    const sqlCandidate = initial.findings.find((finding) => finding.label === "SQL string literal");
    expect(sqlCandidate?.disposition).toBe("unreviewed");

    const resolved = prepareTransactionPayload(
      result,
      1,
      ["success"],
      1,
      "lmTool",
      new Map([[sqlCandidate!.id, { disposition: "masked", strategy: "full" }]]),
      identity
    );
    expect(resolved.payload).not.toContain("alice@example.com");
    expect(resolved.findings.every((finding) => finding.disposition !== "unreviewed")).toBe(true);
    expect(resolved.payloadDigest).not.toBe(initial.payloadDigest);
  });

  it("masks SQL literals automatically at Lv2 even when no rows are returned", () => {
    const result: TransactionRunResult = {
      ok: true,
      message: "",
      completed: [
        {
          sql: "UPDATE users SET status = 'disabled' WHERE id = 42",
          rdh: new ResultSetDataBuilder(["affected"]).build(),
        },
      ],
    };
    const prepared = prepareTransactionPayload(result, 1, ["success"], 2, "mcp", new Map(), {
      requestId: "request-2",
      expiresAt: Date.now() + 60_000,
    });
    expect(prepared.payload).not.toContain("disabled");
    expect(prepared.payload).not.toContain("42");
    expect(prepared.findings.every((finding) => finding.disposition === "masked")).toBe(true);
  });
});
