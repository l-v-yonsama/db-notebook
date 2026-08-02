import { describe, expect, it } from "vitest";
import { NotebookCellKind } from "vscode";
import type { NotebookCell } from "vscode";
import {
  hasConnectionCell,
  isCwqlCell,
  isJsOrTsCell,
  isJsonValueCell,
  isMarkupCell,
  isMemcachedCell,
  isMqttCell,
  isSqlCell,
} from "../../src/utilities/notebookUtil";

type FakeCellOptions = {
  kind?: NotebookCellKind;
  languageId?: string;
  metadata?: Record<string, unknown>;
};

const makeCell = ({
  kind = NotebookCellKind.Code,
  languageId = "sql",
  metadata = {},
}: FakeCellOptions = {}): NotebookCell =>
  ({
    kind,
    document: { languageId },
    metadata,
  }) as unknown as NotebookCell;

describe("isMarkupCell", () => {
  it("Markup種別のセルはtrue", () => {
    expect(isMarkupCell(makeCell({ kind: NotebookCellKind.Markup }))).toBe(true);
  });

  it("Code種別のセルはfalse", () => {
    expect(isMarkupCell(makeCell({ kind: NotebookCellKind.Code }))).toBe(false);
  });
});

describe("isSqlCell", () => {
  it("言語がsqlのcodeセルはtrue", () => {
    expect(isSqlCell(makeCell({ languageId: "sql" }))).toBe(true);
  });

  it("言語がsql以外ならfalse", () => {
    expect(isSqlCell(makeCell({ languageId: "javascript" }))).toBe(false);
  });

  it("markupセルはfalse", () => {
    expect(isSqlCell(makeCell({ kind: NotebookCellKind.Markup, languageId: "sql" }))).toBe(false);
  });
});

describe("isCwqlCell", () => {
  it("言語がcwqlのcodeセルはtrue", () => {
    expect(isCwqlCell(makeCell({ languageId: "cwql" }))).toBe(true);
  });

  it("言語がcwql以外ならfalse", () => {
    expect(isCwqlCell(makeCell({ languageId: "sql" }))).toBe(false);
  });
});

describe("isMemcachedCell", () => {
  it("言語がmemcachedのcodeセルはtrue", () => {
    expect(isMemcachedCell(makeCell({ languageId: "memcached" }))).toBe(true);
  });

  it("言語がmemcached以外ならfalse", () => {
    expect(isMemcachedCell(makeCell({ languageId: "sql" }))).toBe(false);
  });
});

describe("isJsOrTsCell", () => {
  it("言語がjavascriptのcodeセルはtrue", () => {
    expect(isJsOrTsCell(makeCell({ languageId: "javascript" }))).toBe(true);
  });

  it("言語がtypescriptのcodeセルもtrue", () => {
    expect(isJsOrTsCell(makeCell({ languageId: "typescript" }))).toBe(true);
  });

  it("言語がjavascript/typescript以外ならfalse", () => {
    expect(isJsOrTsCell(makeCell({ languageId: "sql" }))).toBe(false);
  });
});

describe("isJsonValueCell", () => {
  it("publishParamsが無いjson言語のcodeセルはtrue", () => {
    expect(isJsonValueCell(makeCell({ languageId: "json" }))).toBe(true);
  });

  it("publishParamsを持つjsonセルはMQTT用途なのでfalse", () => {
    expect(
      isJsonValueCell(makeCell({ languageId: "json", metadata: { publishParams: {} } }))
    ).toBe(false);
  });

  it("言語がjson以外ならfalse", () => {
    expect(isJsonValueCell(makeCell({ languageId: "sql" }))).toBe(false);
  });
});

describe("isMqttCell", () => {
  it("publishParamsを持つ非jsセルはtrue", () => {
    expect(isMqttCell(makeCell({ languageId: "json", metadata: { publishParams: {} } }))).toBe(
      true
    );
  });

  it("javascriptセルはpublishParamsがあってもfalse", () => {
    expect(
      isMqttCell(makeCell({ languageId: "javascript", metadata: { publishParams: {} } }))
    ).toBe(false);
  });

  it("publishParamsが無ければfalse", () => {
    expect(isMqttCell(makeCell({ languageId: "json" }))).toBe(false);
  });
});

describe("hasConnectionCell", () => {
  it("sql/cwql/memcached/MQTT用JSONセルはtrue", () => {
    expect(hasConnectionCell(makeCell({ languageId: "sql" }))).toBe(true);
    expect(hasConnectionCell(makeCell({ languageId: "cwql" }))).toBe(true);
    expect(hasConnectionCell(makeCell({ languageId: "memcached" }))).toBe(true);
    expect(
      hasConnectionCell(makeCell({ languageId: "json", metadata: { publishParams: {} } }))
    ).toBe(true);
  });

  it("javascriptセルやmarkupセルはfalse", () => {
    expect(hasConnectionCell(makeCell({ languageId: "javascript" }))).toBe(false);
    expect(hasConnectionCell(makeCell({ kind: NotebookCellKind.Markup }))).toBe(false);
  });
});
