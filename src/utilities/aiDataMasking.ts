import { createHash, randomUUID } from "crypto";
import type {
  AiMaskingFinding,
  AiMaskingLevel,
  AiPayloadFindingResolution,
  AiPayloadTruncation,
  PreparedAiPayload,
} from "../shared/AiDataMasking";

export const AI_PAYLOAD_MAX_BYTES = 1024 * 1024;
export const AI_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
export const AI_UNMASKED_DATA_GUIDANCE_LINES = [
  "If the user asks for unmasked or raw data, tell them to open the target connection's settings in Database Notebook, change 'AI data masking' to 'Lv0 - No masking', and retry the same request.",
  "You cannot change this setting yourself. Do not claim that an administrator is required.",
  "Do not suggest reading stored database credentials, using an external database client or script, or otherwise bypassing Database Notebook.",
] as const;

const AI_MASKING_NOTE_RESERVE_BYTES = 2048;

type RawFinding = {
  id: string;
  start: number;
  end: number;
  label: string;
  autoMask: boolean;
  replacement: string;
  partialReplacement: string;
};

export type PrepareAiTextPayloadOptions = {
  level: Exclude<AiMaskingLevel, 0>;
  destination: PreparedAiPayload["destination"];
  requestId?: string;
  expiresAt?: number;
  resolutions?: ReadonlyMap<string, AiPayloadFindingResolution>;
  inputKind?: "embedded" | "sql" | "json" | "definition";
  includeNote?: boolean;
  idScope?: string;
};

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { label: "AWS access key", pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  {
    label: "PEM private key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
];

function findingId(kind: string, start: number, end: number, value: string, scope = ""): string {
  return createHash("sha256")
    .update(`${scope}:${kind}:${start}:${end}:${value}`)
    .digest("hex")
    .slice(0, 20);
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateByWholeLines(
  value: string,
  maxBytes: number
): { value: string; truncation?: AiPayloadTruncation } {
  const originalBytes = utf8Bytes(value);
  if (originalBytes <= maxBytes) {
    return { value };
  }
  const suffix =
    "\n\n[TRUNCATED: additional input was omitted to keep the AI payload within 1 MiB.]";
  const budget = maxBytes - utf8Bytes(suffix);
  const lines = value.split(/(?<=\n)/);
  const includedLines: string[] = [];
  let includedBytes = 0;
  for (const line of lines) {
    const lineBytes = utf8Bytes(line);
    if (includedBytes + lineBytes > budget) {
      break;
    }
    includedLines.push(line);
    includedBytes += lineBytes;
  }
  const included = includedLines.join("");
  const result = included + suffix;
  return {
    value: result,
    truncation: {
      originalBytes,
      includedBytes: utf8Bytes(result),
      omittedApproxBytes: Math.max(0, originalBytes - includedBytes),
    },
  };
}

function sqlFenceRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /```(?:sql|partiql)\s*\n([\s\S]*?)```/gi;
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    const bodyOffset = match[0].indexOf(match[1]);
    ranges.push({
      start: match.index + bodyOffset,
      end: match.index + bodyOffset + match[1].length,
    });
  }
  return ranges;
}

function jsonSqlStringRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const fencePattern = /```json\s*\n([\s\S]*?)```/gi;
  const sqlValuePattern =
    /"(?:sql|text|baselineText|currentText|defaultExpression|checkExpression|expression)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  for (const fence of value.matchAll(fencePattern)) {
    if (fence.index === undefined) {
      continue;
    }
    const bodyOffset = fence.index + fence[0].indexOf(fence[1]);
    sqlValuePattern.lastIndex = 0;
    for (const match of fence[1].matchAll(sqlValuePattern)) {
      if (match.index === undefined) {
        continue;
      }
      const valueOffset = match[0].lastIndexOf(match[1]);
      ranges.push({
        start: bodyOffset + match.index + valueOffset,
        end: bodyOffset + match.index + valueOffset + match[1].length,
      });
    }
  }
  return ranges;
}

function rawJsonSqlStringRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern =
    /"(?:sql|text|baselineText|currentText|defaultExpression|checkExpression|expression)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    const valueOffset = match[0].lastIndexOf(match[1]);
    ranges.push({
      start: match.index + valueOffset,
      end: match.index + valueOffset + match[1].length,
    });
  }
  return ranges;
}

function rawJsonDdlRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /"ddl"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    const valueOffset = match[0].lastIndexOf(match[1]);
    ranges.push({
      start: match.index + valueOffset,
      end: match.index + valueOffset + match[1].length,
    });
  }
  return ranges;
}

function jsonDdlStringRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const fencePattern = /```json\s*\n([\s\S]*?)```/gi;
  const ddlPattern = /"ddl"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  for (const fence of value.matchAll(fencePattern)) {
    if (fence.index === undefined) {
      continue;
    }
    const bodyOffset = fence.index + fence[0].indexOf(fence[1]);
    ddlPattern.lastIndex = 0;
    for (const match of fence[1].matchAll(ddlPattern)) {
      if (match.index === undefined) {
        continue;
      }
      const valueOffset = match[0].lastIndexOf(match[1]);
      ranges.push({
        start: bodyOffset + match.index + valueOffset,
        end: bodyOffset + match.index + valueOffset + match[1].length,
      });
    }
  }
  return ranges;
}

function scanDefinitionRange(
  value: string,
  range: { start: number; end: number },
  level: 1 | 2,
  scope = ""
): RawFinding[] {
  const findings = scanSqlLiterals(value, range.start, range.end, level, scope, false);
  const fragment = value.slice(range.start, range.end);
  for (const expression of definitionExpressionRanges(fragment)) {
    findings.push(
      ...scanSqlLiterals(
        value,
        range.start + expression.start,
        range.start + expression.end,
        level,
        scope,
        true
      )
    );
  }
  return findings;
}

function scanSqlLiterals(
  value: string,
  start: number,
  end: number,
  level: 1 | 2,
  scope = "",
  includeNumbers = true
): RawFinding[] {
  const findings: RawFinding[] = [];
  let i = start;
  let lineComment = false;
  let blockComment = false;
  while (i < end) {
    const ch = value[i];
    const next = value[i + 1];
    if (lineComment) {
      if (ch === "\n" || (ch === "\\" && next === "n")) {
        lineComment = false;
      }
      i += 1;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      const literalStart = i;
      i += 1;
      while (i < end) {
        if (value[i] === "\\" && i + 1 < end) {
          i += 2;
          continue;
        }
        if (value[i] === "'" && value[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (value[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      const raw = value.slice(literalStart, i);
      findings.push({
        id: findingId("sql-string", literalStart, i, raw, scope),
        start: literalStart,
        end: i,
        label: "SQL string literal",
        autoMask: level === 2,
        replacement: "?",
        partialReplacement: raw.length > 3 ? `${raw.slice(0, 2)}***'` : "?",
      });
      continue;
    }
    if (ch === "$") {
      const delimiter = value.slice(i, end).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const literalStart = i;
        const closing = value.indexOf(delimiter, i + delimiter.length);
        i = closing >= 0 && closing < end ? closing + delimiter.length : end;
        const raw = value.slice(literalStart, i);
        findings.push({
          id: findingId("sql-dollar-string", literalStart, i, raw, scope),
          start: literalStart,
          end: i,
          label: "SQL dollar-quoted string literal",
          autoMask: level === 2,
          replacement: "?",
          partialReplacement: "?",
        });
        continue;
      }
    }
    const previous = i > start ? value[i - 1] : "";
    if (includeNumbers && /\d/.test(ch) && !/[A-Za-z0-9_$]/.test(previous)) {
      const match = value.slice(i, end).match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        const raw = match[0];
        const literalEnd = i + raw.length;
        const following = value[literalEnd] ?? "";
        if (!/[A-Za-z0-9_$]/.test(following)) {
          findings.push({
            id: findingId("sql-number", i, literalEnd, raw, scope),
            start: i,
            end: literalEnd,
            label: "SQL numeric literal",
            autoMask: level === 2,
            replacement: "?",
            partialReplacement: "?",
          });
          i = literalEnd;
          continue;
        }
      }
    }
    i += 1;
  }
  return findings;
}

function scanSecrets(value: string, scope = ""): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { label, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      if (match.index === undefined) {
        continue;
      }
      findings.push({
        id: findingId(label, match.index, match.index + match[0].length, match[0], scope),
        start: match.index,
        end: match.index + match[0].length,
        label,
        autoMask: true,
        replacement: `<masked:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>`,
        partialReplacement: "<masked:secret>",
      });
    }
  }
  return findings;
}

function scanTextCandidates(
  value: string,
  level: 1 | 2,
  scope: string,
  includeSqlComments: boolean
): RawFinding[] {
  const findings: RawFinding[] = [];
  const add = (start: number, end: number, label: string): void => {
    const raw = value.slice(start, end);
    if (!raw.trim()) {
      return;
    }
    findings.push({
      id: findingId(label, start, end, raw, scope),
      start,
      end,
      label,
      autoMask: level === 2,
      replacement: `<masked:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>`,
      partialReplacement: "<masked:text>",
    });
  };

  const jsonPattern = /"(?:comment|description)"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  for (const match of value.matchAll(jsonPattern)) {
    if (match.index === undefined) {
      continue;
    }
    const offset = match[0].lastIndexOf(match[1]);
    add(match.index + offset, match.index + offset + match[1].length, "Free-text definition");
  }

  const labeledLinePattern = /(?:^|\n)\s*(?:comment|description)\s*[:=]\s*([^\n]+)/gi;
  for (const match of value.matchAll(labeledLinePattern)) {
    if (match.index === undefined) {
      continue;
    }
    const offset = match[0].lastIndexOf(match[1]);
    add(match.index + offset, match.index + offset + match[1].length, "Free-text definition");
  }

  const resourceDetailsPattern = /(?:^|\n)\s*-\s+[^\n(]+\(([^)\n]+)\)/g;
  for (const match of value.matchAll(resourceDetailsPattern)) {
    if (match.index === undefined) {
      continue;
    }
    const detailsOffset = match.index + match[0].lastIndexOf(match[1]);
    let searchFrom = 0;
    for (const part of match[1].split(/,\s*/)) {
      const relativeStart = match[1].indexOf(part, searchFrom);
      searchFrom = relativeStart + part.length;
      if (
        /^(?:type|rotation|users|groups|clients|organizations|count|modified|status|qos|keys?)\s*:/i.test(
          part
        )
      ) {
        continue;
      }
      add(
        detailsOffset + relativeStart,
        detailsOffset + relativeStart + part.length,
        "Free-text definition"
      );
    }
  }

  if (includeSqlComments) {
    for (const match of value.matchAll(/--([^\n]*)/g)) {
      if (match.index !== undefined) {
        const offset = match[0].indexOf(match[1]);
        add(match.index + offset, match.index + offset + match[1].length, "SQL comment");
      }
    }
    for (const match of value.matchAll(/\/\*([\s\S]*?)\*\//g)) {
      if (match.index !== undefined) {
        const offset = match[0].indexOf(match[1]);
        add(match.index + offset, match.index + offset + match[1].length, "SQL comment");
      }
    }
  }
  return findings;
}

function definitionExpressionRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /\b(?:DEFAULT|CHECK)\b[^,\n;]*/gi;
  for (const match of value.matchAll(pattern)) {
    if (match.index !== undefined) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function removeOverlaps(findings: RawFinding[]): RawFinding[] {
  const sorted = [...findings].sort(
    (a, b) => Number(b.autoMask) - Number(a.autoMask) || a.start - b.start || b.end - a.end
  );
  const result: RawFinding[] = [];
  for (const finding of sorted) {
    const overlap = result.some(
      (existing) => finding.start < existing.end && finding.end > existing.start
    );
    if (!overlap) {
      result.push(finding);
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

function maskingNote(
  level: 1 | 2,
  masked: number,
  candidates: number,
  truncation?: AiPayloadTruncation
): string {
  const lines = [
    "NOTE: Database Notebook processed this payload with best-effort AI data masking.",
    `Masking level: ${level}. Masked findings: ${masked}. Unreviewed candidates: ${candidates}.`,
    "Do not infer or reconstruct masked values. Unmarked values are not guaranteed to be non-sensitive.",
    ...AI_UNMASKED_DATA_GUIDANCE_LINES,
  ];
  if (truncation) {
    lines.push(
      `truncated: true; omitted approximately ${truncation.omittedApproxBytes} UTF-8 bytes.`
    );
  }
  return `${lines.join("\n")}\n\n`;
}

export function prepareAiTextPayload(
  rawPayload: string,
  options: PrepareAiTextPayloadOptions
): PreparedAiPayload {
  const disclosureAdjusted = rawPayload
    .split("it has not been masked or redacted")
    .join("it was processed with best-effort masking");
  const truncated = truncateByWholeLines(
    disclosureAdjusted,
    AI_PAYLOAD_MAX_BYTES - AI_MASKING_NOTE_RESERVE_BYTES
  );
  const inputKind = options.inputKind ?? "embedded";
  const sqlRanges =
    inputKind === "sql"
      ? [{ start: 0, end: truncated.value.length }]
      : inputKind === "json"
      ? rawJsonSqlStringRanges(truncated.value)
      : inputKind === "definition"
      ? [...sqlFenceRanges(truncated.value), ...rawJsonSqlStringRanges(truncated.value)]
      : [...sqlFenceRanges(truncated.value), ...jsonSqlStringRanges(truncated.value)];
  const definitionStringFindings =
    inputKind === "definition"
      ? scanSqlLiterals(
          truncated.value,
          0,
          truncated.value.length,
          options.level,
          options.idScope,
          false
        )
      : [];
  const definitionNumberFindings =
    inputKind === "definition"
      ? definitionExpressionRanges(truncated.value).flatMap((range) =>
          scanSqlLiterals(
            truncated.value,
            range.start,
            range.end,
            options.level,
            options.idScope,
            true
          )
        )
      : [];
  const ddlRanges =
    inputKind === "json"
      ? rawJsonDdlRanges(truncated.value)
      : inputKind === "embedded"
      ? jsonDdlStringRanges(truncated.value)
      : [];
  const jsonDdlFindings = ddlRanges.length
    ? ddlRanges.flatMap((range) =>
        scanDefinitionRange(truncated.value, range, options.level, options.idScope)
      )
    : [];
  const rawFindings = removeOverlaps([
    ...scanSecrets(truncated.value, options.idScope),
    ...sqlRanges.flatMap((range) =>
      scanSqlLiterals(truncated.value, range.start, range.end, options.level, options.idScope)
    ),
    ...definitionStringFindings,
    ...definitionNumberFindings,
    ...jsonDdlFindings,
    ...(inputKind === "json" || inputKind === "definition"
      ? scanTextCandidates(
          truncated.value,
          options.level,
          options.idScope ?? "",
          inputKind === "definition"
        )
      : []),
  ]);

  let body = "";
  let cursor = 0;
  const findings: AiMaskingFinding[] = [];
  for (const finding of rawFindings) {
    body += truncated.value.slice(cursor, finding.start);
    const resolution = options.resolutions?.get(finding.id);
    const masked = finding.autoMask || resolution?.disposition === "masked";
    const allowed = resolution?.disposition === "allowed";
    const replacement = masked
      ? resolution?.strategy === "partial"
        ? finding.partialReplacement
        : finding.replacement
      : truncated.value.slice(finding.start, finding.end);
    const outputStart = body.length;
    body += replacement;
    findings.push({
      id: finding.id,
      kind: masked ? "masked" : "candidate",
      label: finding.label,
      originalText: truncated.value.slice(finding.start, finding.end),
      strategy: masked ? (resolution?.strategy === "partial" ? "partial" : "full") : undefined,
      disposition: masked ? "masked" : allowed ? "allowed" : "unreviewed",
      ranges: [{ start: outputStart, end: body.length }],
    });
    cursor = finding.end;
  }
  body += truncated.value.slice(cursor);

  const maskedCount = findings.filter((finding) => finding.disposition === "masked").length;
  const candidateCount = findings.filter((finding) => finding.disposition === "unreviewed").length;
  const note =
    options.includeNote === false
      ? ""
      : maskingNote(options.level, maskedCount, candidateCount, truncated.truncation);
  for (const finding of findings) {
    finding.ranges = finding.ranges.map((range) => ({
      start: range.start + note.length,
      end: range.end + note.length,
    }));
  }
  const payload = note + body;
  return {
    requestId: options.requestId ?? randomUUID(),
    payload,
    payloadDigest: createHash("sha256").update(payload).digest("hex"),
    level: options.level,
    destination: options.destination,
    expiresAt: options.expiresAt ?? Date.now() + AI_APPROVAL_TIMEOUT_MS,
    findings,
    truncation: truncated.truncation,
  };
}
