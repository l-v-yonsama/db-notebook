import { describe, expect, it } from "vitest";
import { AI_PAYLOAD_MAX_BYTES, prepareAiTextPayload } from "../../src/utilities/aiDataMasking";

describe("prepareAiTextPayload", () => {
  it("keeps ordinary SQL literals as unresolved candidates at level 1", () => {
    const prepared = prepareAiTextPayload(
      "```sql\nSELECT * FROM t WHERE id = 42 AND name = 'Alice'\n```",
      {
        level: 1,
        destination: "clipboard",
      }
    );
    expect(prepared.payload).toContain("id = 42");
    expect(prepared.payload).toContain("name = 'Alice'");
    expect(
      prepared.findings.filter((finding) => finding.disposition === "unreviewed")
    ).toHaveLength(2);
  });

  it("masks all recognized SQL literals at level 2 without changing comments", () => {
    const prepared = prepareAiTextPayload(
      "```sql\nSELECT * FROM t -- 123\nWHERE id = 42 AND name = 'Alice'\n```",
      {
        level: 2,
        destination: "copilot",
      }
    );
    expect(prepared.payload).toContain("-- 123");
    expect(prepared.payload).toContain("id = ?");
    expect(prepared.payload).toContain("name = ?");
    expect(prepared.findings.every((finding) => finding.disposition === "masked")).toBe(true);
    expect(prepared.findings.map((finding) => finding.originalText)).toEqual(
      expect.arrayContaining(["42", "'Alice'"])
    );
  });

  it("masks the duplicate SQL stored inside a JSON context block", () => {
    const raw = [
      "```sql",
      "SELECT * FROM t WHERE id = 42",
      "```",
      "```json",
      JSON.stringify({ statement: { sql: "SELECT * FROM t WHERE id = 42" } }, null, 2),
      "```",
    ].join("\n");
    const prepared = prepareAiTextPayload(raw, { level: 2, destination: "copilot" });
    expect(prepared.payload).not.toContain("id = 42");
    expect(prepared.payload.match(/id = \?/g)).toHaveLength(2);
  });

  it("recognizes PostgreSQL dollar-quoted and backslash-escaped string literals", () => {
    const raw = "```sql\nSELECT $$secret$$, 'it\\'s private'\n```";
    const prepared = prepareAiTextPayload(raw, { level: 2, destination: "copilot" });
    expect(prepared.payload).not.toContain("secret");
    expect(prepared.payload).not.toContain("private");
    expect(prepared.payload).toContain("SELECT ?, ?");
  });

  it("always fully masks high-confidence secrets", () => {
    const key = `AKIA${"A".repeat(16)}`;
    const prepared = prepareAiTextPayload(`diagnostic=${key}`, {
      level: 1,
      destination: "clipboard",
    });
    expect(prepared.payload).not.toContain(key);
    expect(prepared.payload).toContain("<masked:aws-access-key>");
    expect(prepared.payload).toContain("change 'AI data masking' to 'Lv0 - No masking'");
    expect(prepared.payload).toContain("Do not suggest reading stored database credentials");
    expect(prepared.findings[0].originalText).toBe(key);
  });

  it("prioritizes a secret inside a SQL literal over the unresolved literal candidate", () => {
    const key = `sk-${"a".repeat(24)}`;
    const prepared = prepareAiTextPayload(`\`\`\`sql\nSELECT '${key}'\n\`\`\``, {
      level: 1,
      destination: "copilot",
    });
    expect(prepared.payload).not.toContain(key);
    expect(prepared.findings).toHaveLength(1);
    expect(prepared.findings[0].disposition).toBe("masked");
  });

  it("applies candidate resolutions using stable finding ids", () => {
    const raw = "```sql\nSELECT * FROM t WHERE email = 'alice@example.com'\n```";
    const initial = prepareAiTextPayload(raw, { level: 1, destination: "clipboard" });
    const candidate = initial.findings.find((finding) => finding.disposition === "unreviewed")!;
    const prepared = prepareAiTextPayload(raw, {
      level: 1,
      destination: "clipboard",
      requestId: initial.requestId,
      resolutions: new Map([[candidate.id, { disposition: "masked", strategy: "full" }]]),
    });
    expect(prepared.requestId).toBe(initial.requestId);
    expect(prepared.payload).not.toContain("alice@example.com");
    expect(prepared.findings[0].disposition).toBe("masked");
  });

  it("allows a reviewed candidate without changing its value and changes the digest", () => {
    const raw = "```sql\nSELECT * FROM t WHERE id = 42\n```";
    const initial = prepareAiTextPayload(raw, { level: 1, destination: "clipboard" });
    const candidate = initial.findings[0];
    const prepared = prepareAiTextPayload(raw, {
      level: 1,
      destination: "clipboard",
      requestId: initial.requestId,
      resolutions: new Map([[candidate.id, { disposition: "allowed" }]]),
    });
    expect(prepared.payload).toContain("id = 42");
    expect(prepared.findings[0].disposition).toBe("allowed");
    expect(prepared.payloadDigest).not.toBe(initial.payloadDigest);
  });

  it("caps the final payload below 1 MiB without splitting UTF-8", () => {
    const prepared = prepareAiTextPayload("あいうえお\n".repeat(100_000), {
      level: 2,
      destination: "clipboard",
    });
    expect(Buffer.byteLength(prepared.payload, "utf8")).toBeLessThanOrEqual(AI_PAYLOAD_MAX_BYTES);
    expect(prepared.truncation).toBeDefined();
    expect(prepared.payload).toContain("truncated: true");
  });

  it("scans a raw SQL statement without requiring a Markdown fence", () => {
    const prepared = prepareAiTextPayload("SELECT * FROM t WHERE id = 42 AND code = 'A'", {
      level: 2,
      destination: "lmTool",
      inputKind: "sql",
    });
    expect(prepared.payload).toContain("id = ?");
    expect(prepared.payload).toContain("code = ?");
  });

  it("scans SQL and free-text fields in a raw context JSON payload", () => {
    const raw = JSON.stringify({
      statement: { sql: "SELECT * FROM users WHERE tenant_id = 123" },
      table: { comment: "customer owner: Alice" },
    });
    const prepared = prepareAiTextPayload(raw, {
      level: 1,
      destination: "mcp",
      inputKind: "json",
    });
    expect(prepared.findings.map((finding) => finding.label)).toEqual(
      expect.arrayContaining(["SQL numeric literal", "Free-text definition"])
    );
    expect(prepared.findings.every((finding) => finding.disposition === "unreviewed")).toBe(true);
  });

  it("preserves DDL type dimensions inside context JSON while masking defaults", () => {
    const raw = JSON.stringify({
      definition: {
        ddl: "CREATE TABLE t (name VARCHAR(255) DEFAULT 'Alice', retries INT DEFAULT 7)",
      },
    });
    const prepared = prepareAiTextPayload(raw, {
      level: 2,
      destination: "lmTool",
      inputKind: "json",
    });
    expect(prepared.payload).toContain("VARCHAR(255)");
    expect(prepared.payload).not.toContain("Alice");
    expect(prepared.payload).not.toContain("DEFAULT 7");
  });

  it("applies the same DDL rules inside an embedded JSON fence", () => {
    const raw = `\`\`\`json\n${JSON.stringify({
      ddl: "CREATE TABLE t (v VARCHAR(64) DEFAULT 'x')",
    })}\n\`\`\``;
    const prepared = prepareAiTextPayload(raw, {
      level: 2,
      destination: "copilot",
    });
    expect(prepared.payload).toContain("VARCHAR(64)");
    expect(prepared.payload).not.toContain("DEFAULT 'x'");
  });

  it("handles definition comments and defaults without masking type dimensions", () => {
    const raw = [
      "CREATE TABLE users (",
      "  display_name VARCHAR(255) DEFAULT 'Alice',",
      "  retry_count INTEGER DEFAULT 7 CHECK (retry_count < 10)",
      ");",
      "-- production customer table",
      "Description: owned by the customer success team",
    ].join("\n");
    const prepared = prepareAiTextPayload(raw, {
      level: 2,
      destination: "lmTool",
      inputKind: "definition",
    });
    expect(prepared.payload).toContain("VARCHAR(255)");
    expect(prepared.payload).toContain("DEFAULT ?");
    expect(prepared.payload).not.toContain("production customer table");
    expect(prepared.payload).not.toContain("customer success team");
  });

  it("finds free descriptions embedded in schema resource bullet details", () => {
    const prepared = prepareAiTextPayload(
      [
        "## Secrets",
        "- prod/api (owned by Alice, rotation: enabled)",
        "- metadata-only (type: String, modified: 2026-08-31)",
      ].join("\n"),
      {
        level: 1,
        destination: "mcp",
        inputKind: "definition",
      }
    );
    expect(prepared.findings).toHaveLength(1);
    expect(prepared.findings[0].label).toBe("Free-text definition");
    expect(prepared.payload).toContain("owned by Alice");
  });

  it("supports note-free scoped fragments for a composite final payload", () => {
    const first = prepareAiTextPayload("SELECT 1", {
      level: 1,
      destination: "lmTool",
      inputKind: "sql",
      includeNote: false,
      idScope: "first",
    });
    const second = prepareAiTextPayload("SELECT 1", {
      level: 1,
      destination: "lmTool",
      inputKind: "sql",
      includeNote: false,
      idScope: "second",
    });
    expect(first.payload).toBe("SELECT 1");
    expect(first.findings[0].id).not.toBe(second.findings[0].id);
  });
});
