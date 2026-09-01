import { createHash, randomUUID } from "crypto";
import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import type {
  AiMaskingFinding,
  AiPayloadFindingResolution,
  PreparedAiPayload,
} from "../shared/AiDataMasking";
import {
  AI_APPROVAL_TIMEOUT_MS,
  AI_PAYLOAD_MAX_BYTES,
  AI_UNMASKED_DATA_GUIDANCE_LINES,
} from "./aiDataMasking";

type Category =
  | "secret"
  | "email"
  | "phone"
  | "address"
  | "address-region"
  | "country"
  | "name"
  | "birth-date"
  | "payment"
  | "public-id"
  | "ip-address"
  | "payload";

type CellFinding = {
  id: string;
  rowIndex: number;
  keyName: string;
  label: string;
  original: unknown;
  full: unknown;
  partial: unknown;
  autoMask: boolean;
  typed: unknown;
};

function originalText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export type PrepareAiRdhPayloadOptions = {
  level: 1 | 2;
  destination: PreparedAiPayload["destination"];
  limit: number;
  requestId?: string;
  expiresAt?: number;
  resolutions?: ReadonlyMap<string, AiPayloadFindingResolution>;
  idScope?: string;
};

const COLUMN_RULES: Array<{ category: Category; pattern: RegExp }> = [
  {
    category: "secret",
    pattern:
      /(^|_)(password|passwd|pwd|secret|token|api_?key|access_?key|private_?key|credential|authorization|receipt_?handle|client_?secret)($|_)/i,
  },
  { category: "email", pattern: /(^|_)(email|e_?mail|mail_?address)($|_)/i },
  { category: "phone", pattern: /(^|_)(phone|tel|telephone|mobile|fax)($|_)/i },
  { category: "birth-date", pattern: /(^|_)(birth|birthday|date_?of_?birth|dob)($|_)/i },
  {
    category: "payment",
    pattern:
      /(^|_)(credit_?card|card_?(?:number|no)|cvv|pan|iban|bank_?account|routing_?number)($|_)/i,
  },
  {
    category: "public-id",
    pattern:
      /(^|_)(ssn|social_?security|passport|license|driver_?license|my_?number|national_?id)($|_)/i,
  },
  {
    category: "address",
    pattern:
      /(^|_)(address|addr|street|address_?line\d*|building|apartment|postal(?:_?code)?|zip)($|_)/i,
  },
  {
    category: "country",
    pattern: /(^|_)(country|country_?code)($|_)/i,
  },
  {
    category: "address-region",
    pattern: /(^|_)(state|province|prefecture|city|municipality|county)($|_)/i,
  },
  {
    category: "name",
    pattern: /(^|_)(name|first_?name|last_?name|full_?name|given_?name|family_?name|kana)($|_)/i,
  },
  { category: "payload", pattern: /(^|_)(body|payload|val|value|message|content|data)($|_)/i },
  { category: "secret", pattern: /(パスワード|秘密|認証|トークン|鍵)/ },
  { category: "email", pattern: /(メール|電子メール)/ },
  { category: "phone", pattern: /(電話|携帯|ファックス)/ },
  { category: "birth-date", pattern: /(生年月日|誕生日)/ },
  { category: "address", pattern: /(住所|郵便番号|番地|建物)/ },
  { category: "country", pattern: /(^|_)(国|国コード)($|_)/ },
  { category: "address-region", pattern: /(都道府県|市区町村)/ },
  { category: "name", pattern: /(氏名|姓名|名前|フリガナ|顧客名)/ },
  { category: "name", pattern: /(^|_)(姓|名|カナ)($|_)/ },
  { category: "public-id", pattern: /(マイナンバー|個人番号|旅券番号|免許証番号)/ },
];

const SECRET_PATTERNS = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{7,}[0-9]$/;
const IP_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const VALUE_SAMPLE_SIZE = 20;

function normalizedKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .toLowerCase();
}

function columnCategory(name: string, comment?: string): Category | undefined {
  const target = `${normalizedKey(name)}_${normalizedKey(comment ?? "")}`;
  return COLUMN_RULES.find((rule) => rule.pattern.test(target))?.category;
}

function passesLuhn(value: string): boolean {
  const digits = value.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function detectedCategory(value: unknown): Category | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    return "secret";
  }
  const trimmed = value.trim();
  if (EMAIL_PATTERN.test(trimmed)) {
    return "email";
  }
  if (PHONE_PATTERN.test(trimmed)) {
    return "phone";
  }
  if (IP_PATTERN.test(trimmed) && trimmed.split(".").every((v) => Number(v) <= 255)) {
    return "ip-address";
  }
  if (passesLuhn(trimmed)) {
    return "payment";
  }
  return undefined;
}

function typedReplacement(value: unknown, columnType?: string): string {
  if (columnType && /^(date|time|timestamp|year)/.test(columnType)) {
    return "<masked:timestamp>";
  }
  if (columnType && /^(json|jsonb|xml)$/.test(columnType)) {
    return "<masked:json>";
  }
  if (columnType && /(binary|blob|bytea)/.test(columnType)) {
    return "<masked:binary>";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return "<masked:number>";
  }
  if (typeof value === "boolean") {
    return "<masked:boolean>";
  }
  if (value instanceof Date) {
    return "<masked:timestamp>";
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return "<masked:binary>";
  }
  if (typeof value === "object") {
    return "<masked:json>";
  }
  return "<masked:text>";
}

function fullReplacement(category: Category): string {
  return `<masked:${category}>`;
}

function japaneseAddressPartial(value: string): string | undefined {
  const match = value.match(
    /^(〒?\d{3}-?\d{4}\s*)?((?:北海道|東京都|大阪府|京都府|.{2,3}県))([^\d\s,，]{1,16}?(?:市|区|町|村))/
  );
  if (match) {
    return `${match[2]}${match[3]}***`;
  }
  const prefecture = value.match(/^(北海道|東京都|大阪府|京都府|.{2,3}県)/)?.[1];
  return prefecture ? `${prefecture}***` : undefined;
}

function partialReplacement(category: Category, value: unknown): unknown {
  const text = String(value);
  switch (category) {
    case "email": {
      const [local, domain = ""] = text.split("@");
      const parts = domain.split(".");
      return `${local.slice(0, 1)}***@${parts[0]?.slice(0, 1) ?? ""}***${
        parts.length > 1 ? `.${parts.at(-1)}` : ""
      }`;
    }
    case "phone":
      return `${text.replace(/\D/g, "").slice(0, 3)}-****-****`;
    case "birth-date":
      return `${text.match(/\d{4}/)?.[0] ?? "****"}-**-**`;
    case "address":
      return japaneseAddressPartial(text) ?? fullReplacement("address");
    case "address-region":
      return `${text.slice(0, 1)}***`;
    case "name":
      return `${Array.from(text)[0] ?? ""}***`;
    case "ip-address": {
      const p = text.split(".");
      return p.length === 4 ? `${p[0]}.${p[1]}.*.*` : fullReplacement(category);
    }
    default:
      return fullReplacement(category);
  }
}

function stableId(
  rowIndex: number,
  keyName: string,
  value: unknown,
  category: Category,
  scope = ""
): string {
  return createHash("sha256")
    .update(`${scope}:${rowIndex}:${keyName}:${category}:${String(value)}`)
    .digest("hex")
    .slice(0, 20);
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function canApplyPartial(category: Category, value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (category === "email") {
    return EMAIL_PATTERN.test(trimmed);
  }
  if (category === "phone") {
    return PHONE_PATTERN.test(trimmed);
  }
  if (category === "ip-address") {
    return IP_PATTERN.test(trimmed);
  }
  return true;
}

function maskNote(
  level: 1 | 2,
  masked: number,
  candidates: number,
  rows: { included: number; omitted: number },
  omittedApproxBytes?: number
): string {
  const lines = [
    "NOTE: Database Notebook processed this row data with best-effort AI data masking.",
    `Masking level: ${level}. Masked findings: ${masked}. Unreviewed candidates: ${candidates}.`,
    `Rows included: ${rows.included}. Rows omitted by the configured row limit: ${rows.omitted}.`,
    "Do not infer or reconstruct masked values. Unmarked values are not guaranteed to be non-sensitive.",
    ...AI_UNMASKED_DATA_GUIDANCE_LINES,
  ];
  if (omittedApproxBytes !== undefined) {
    lines.push(`Payload truncated: approximately ${omittedApproxBytes} UTF-8 bytes omitted.`);
  }
  return `${lines.join("\n")}\n\n`;
}

function truncateUtf8(value: string): { value: string; originalBytes?: number } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= AI_PAYLOAD_MAX_BYTES) {
    return { value };
  }
  const suffix =
    "\n\n[TRUNCATED: additional rows were omitted to keep the AI payload within 1 MiB.]";
  const budget = AI_PAYLOAD_MAX_BYTES - Buffer.byteLength(suffix, "utf8");
  let result = "";
  for (const line of value.split(/(?<=\n)/)) {
    if (Buffer.byteLength(result + line, "utf8") > budget) {
      break;
    }
    result += line;
  }
  return { value: result + suffix, originalBytes: bytes };
}

export function prepareAiRdhPayload(
  rdh: ResultSetData,
  options: PrepareAiRdhPayloadOptions
): PreparedAiPayload {
  const rows = rdh.rows.slice(0, options.limit);
  const keys = rdh.keys as Array<{ name: string; comment?: string; type?: string }>;
  const findings: CellFinding[] = [];
  for (const key of keys) {
    const declared = columnCategory(key.name, key.comment);
    const values = rows.map((row) => row.values[key.name]).filter(isPresent);
    const sampledValues = values.slice(0, VALUE_SAMPLE_SIZE);
    const detections = sampledValues.map(detectedCategory).filter((v): v is Category => Boolean(v));
    const threshold =
      sampledValues.length === 1 ? 1 : Math.max(2, Math.ceil(sampledValues.length * 0.6));
    const detectionCounts = new Map<Category, number>();
    detections.forEach((category) => {
      detectionCounts.set(category, (detectionCounts.get(category) ?? 0) + 1);
    });
    const sampled = [...detectionCounts.entries()].find(([, count]) => count >= threshold)?.[0];
    rows.forEach((row, rowIndex) => {
      const original = row.values[key.name];
      if (!isPresent(original)) {
        return;
      }
      const perCell = detectedCategory(original);
      const category = perCell === "secret" ? "secret" : declared ?? sampled ?? perCell;
      if (options.level === 1 && category === "country") {
        return;
      }
      if (options.level === 1 && !category) {
        return;
      }
      const effective = category ?? "payload";
      const isGenericCandidate = options.level === 1 && effective === "payload" && !perCell;
      const incompatiblePartial =
        options.level === 1 &&
        ["email", "phone", "ip-address"].includes(effective) &&
        !canApplyPartial(effective, original);
      findings.push({
        id: stableId(rowIndex, key.name, original, effective, options.idScope),
        rowIndex,
        keyName: key.name,
        label: `${effective} (${key.name})`,
        original,
        full: fullReplacement(effective),
        partial: partialReplacement(effective, original),
        typed: typedReplacement(original, key.type),
        autoMask: options.level === 2 || (!isGenericCandidate && !incompatiblePartial),
      });
    });
  }

  const cloned = {
    ...rdh,
    keys: rdh.keys.map((key) => ({ ...key })),
    rows: rows.map((row) => ({ ...row, meta: { ...row.meta }, values: { ...row.values } })),
  } as ResultSetData;
  const markerMap = new Map<
    string,
    {
      finding: CellFinding;
      replacement: string;
      disposition: "masked" | "allowed" | "unreviewed";
      strategy?: "partial" | "full" | "typed";
    }
  >();
  findings.forEach((finding, index) => {
    const resolution = options.resolutions?.get(finding.id);
    const masked = finding.autoMask || resolution?.disposition === "masked";
    const disposition = masked
      ? "masked"
      : resolution?.disposition === "allowed"
      ? "allowed"
      : "unreviewed";
    const strategy = masked
      ? options.level === 2
        ? "typed"
        : resolution?.strategy === "partial"
        ? "partial"
        : declaredStrategy(finding)
      : undefined;
    const replacement = masked
      ? String(
          strategy === "typed"
            ? finding.typed
            : strategy === "partial"
            ? finding.partial
            : finding.full
        )
      : String(finding.original);
    const marker = `__DBNB_AI_MASK_${index}_${finding.id}__`;
    cloned.rows[finding.rowIndex].values[finding.keyName] = marker;
    markerMap.set(marker, { finding, replacement, disposition, strategy });
  });

  let formatted =
    cloned.rows.length === 0 && cloned.summary?.affectedRows !== undefined
      ? `OK. ${cloned.summary.affectedRows} row(s) affected.`
      : ResultSetDataBuilder.from(cloned).toString({ maxPrintLines: options.limit });
  const outputFindings: AiMaskingFinding[] = [];
  const orderedMarkers = [...markerMap.entries()]
    .map(([marker, item]) => ({ marker, item, start: formatted.indexOf(marker) }))
    .filter((entry) => entry.start >= 0)
    .sort((a, b) => a.start - b.start);
  let offset = 0;
  for (const { marker, item, start: originalStart } of orderedMarkers) {
    const start = originalStart + offset;
    formatted =
      formatted.slice(0, start) + item.replacement + formatted.slice(start + marker.length);
    offset += item.replacement.length - marker.length;
    outputFindings.push({
      id: item.finding.id,
      kind: item.disposition === "masked" ? "masked" : "candidate",
      label: item.finding.label,
      originalText: originalText(item.finding.original),
      strategy: item.strategy,
      disposition: item.disposition,
      ranges: [{ start, end: start + item.replacement.length }],
    });
  }
  const maskedCount = outputFindings.filter((f) => f.disposition === "masked").length;
  const candidateCount = outputFindings.filter((f) => f.disposition === "unreviewed").length;
  const rowCounts = { included: rows.length, omitted: Math.max(0, rdh.rows.length - rows.length) };
  let note = maskNote(options.level, maskedCount, candidateCount, rowCounts);
  let truncated = truncateUtf8(note + formatted);
  if (truncated.originalBytes !== undefined) {
    const firstIncludedBytes = Buffer.byteLength(truncated.value, "utf8");
    note = maskNote(
      options.level,
      maskedCount,
      candidateCount,
      rowCounts,
      Math.max(0, truncated.originalBytes - firstIncludedBytes)
    );
    truncated = truncateUtf8(note + formatted);
  }
  outputFindings.forEach((finding) => {
    finding.ranges = finding.ranges.map((range) => ({
      start: range.start + note.length,
      end: range.end + note.length,
    }));
  });
  const payload = truncated.value;
  return {
    requestId: options.requestId ?? randomUUID(),
    payload,
    payloadDigest: createHash("sha256").update(payload).digest("hex"),
    level: options.level,
    destination: options.destination,
    expiresAt: options.expiresAt ?? Date.now() + AI_APPROVAL_TIMEOUT_MS,
    findings: outputFindings.filter((finding) => finding.ranges[0]?.end <= payload.length),
    truncation: truncated.originalBytes
      ? {
          originalBytes: truncated.originalBytes,
          includedBytes: Buffer.byteLength(payload, "utf8"),
          omittedApproxBytes: Math.max(
            0,
            truncated.originalBytes - Buffer.byteLength(payload, "utf8")
          ),
        }
      : undefined,
  };
}

function declaredStrategy(finding: CellFinding): "partial" | "full" {
  return finding.partial === finding.full ? "full" : "partial";
}
