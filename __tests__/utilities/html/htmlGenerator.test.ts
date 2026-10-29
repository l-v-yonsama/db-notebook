import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import type { Har } from "har-format";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createHtmlFromHarItem, createHtmlFromNotebook, createHtmlFromRpcResult } from "../../../src/utilities/html/htmlGenerator";
import { RPC_RESPONSE_MIME } from "../../../src/notebook/rpcCell";

const tmpFiles: string[] = [];

const tmpHtmlPath = (): string => {
  const p = path.join(
    os.tmpdir(),
    `har-generator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  );
  tmpFiles.push(p);
  return p;
};

afterEach(async () => {
  await Promise.all(tmpFiles.splice(0).map((p) => fs.promises.unlink(p).catch(() => undefined)));
});

// Minimal HAR fixture exercising the fields createHtmlFromHarItem actually reads:
// two entries (a successful JSON GET with a query string, and a failing POST with
// post data, request cookies, and response cookies) so both the "success"/"error"
// status badge branches and the optional QueryString/PostData/Cookies tabs render.
const makeHar = (): Har =>
  ({
    log: {
      version: "1.2",
      creator: { name: "test", version: "1.0" },
      entries: [
        {
          startedDateTime: "2024-01-01T00:00:00.000Z",
          time: 42,
          request: {
            method: "GET",
            url: "https://example.com/api/users?limit=10",
            httpVersion: "HTTP/1.1",
            headers: [{ name: "Accept", value: "application/json" }],
            queryString: [{ name: "limit", value: "10" }],
            cookies: [],
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: 200,
            statusText: "OK",
            httpVersion: "HTTP/1.1",
            headers: [{ name: "Content-Type", value: "application/json" }],
            cookies: [],
            content: {
              size: 2,
              mimeType: "application/json",
              text: '{"ok":true}',
            },
            redirectURL: "",
            headersSize: -1,
            bodySize: -1,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        },
        {
          startedDateTime: "2024-01-01T00:00:01.000Z",
          time: 7,
          request: {
            method: "POST",
            url: "https://example.com/api/users",
            httpVersion: "HTTP/1.1",
            headers: [],
            queryString: [],
            postData: {
              mimeType: "application/json",
              text: '{"name":"Alice"}',
            },
            cookies: [{ name: "session", value: "abc123", path: "/", domain: "example.com" }],
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: 500,
            statusText: "Internal Server Error",
            httpVersion: "HTTP/1.1",
            headers: [],
            cookies: [{ name: "session", value: "abc123", path: "/", domain: "example.com" }],
            content: {
              size: 0,
              mimeType: "text/plain",
              text: "boom",
            },
            redirectURL: "",
            headersSize: -1,
            bodySize: -1,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        },
      ],
    },
    // `rdh` on HarFileTabItem is accepted but not read by createHtmlFromHarItem.
  } as unknown as Har);

describe("createHtmlFromHarItem", () => {
  it("HARエントリからHTMLレポートを生成し、ステータス・メソッド・URLを含む", async () => {
    const targetPath = tmpHtmlPath();
    const rdh = ResultSetDataBuilder.createEmpty().build();

    const err = await createHtmlFromHarItem(
      { title: "har report", res: makeHar(), rdh },
      targetPath
    );
    expect(err).toBe("");

    const html = await fs.promises.readFile(targetPath, "utf8");

    // TOC + per-entry heading both render status/method/url via createAxiosTocInfoHtml
    expect(html).toContain("200 OK");
    expect(html).toContain("500 Internal Server Error");
    expect(html).toContain("GET");
    expect(html).toContain("POST");
    expect(html).toContain("https://example.com/api/users?limit=10");

    // request QueryString tab (only rendered when queryString.length > 0)
    expect(html).toContain("QueryString");
    // request PostData tab (only rendered when request.postData is set)
    expect(html).toContain("PostData");
    // request/response Cookies tab (only rendered when cookies.length > 0)
    expect(html).toContain("Cookies");
    // response Data tab content
    expect(html).toContain("ok");
  });

  it("エントリが0件でもエラーにならず空のレポートを生成する", async () => {
    const targetPath = tmpHtmlPath();
    const rdh = ResultSetDataBuilder.createEmpty().build();
    const emptyHar = { log: { version: "1.2", creator: { name: "t", version: "1" }, entries: [] } } as unknown as Har;

    const err = await createHtmlFromHarItem({ title: "empty", res: emptyHar, rdh }, targetPath);
    expect(err).toBe("");

    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("createHtmlFromNotebook", () => {
  it("renders RPC MIME response once with highlighted JSON and escaped values", async () => {
    const targetPath = tmpHtmlPath();
    const result = {
      version: 1, kind: "response", cellId: "rpc-1", outcome: "success",
      status: { code: 0, name: "OK" }, elapsedMs: 12, receivedCount: 1,
      contents: { value: "</script>```<script>alert(1)</script>" },
      headers: { "x-test": ["ok"] },
    };
    const cell = {
      kind: 2,
      document: { languageId: "rpc-json", getText: () => '{"query":"x"}' },
      metadata: { connectionName: "rpc", rpc: { version: 2, id: "rpc-1", service: "example.Service", method: "Call", callKind: "unary", metadataJson: '{"x-id":"42"}' } },
      outputs: [{ items: [
        { mime: RPC_RESPONSE_MIME, data: Buffer.from(JSON.stringify(result)) },
        { mime: "text/plain", data: Buffer.from("plain summary marker") },
      ] }],
    };
    const err = await createHtmlFromNotebook(
      { getCells: () => [cell] } as never,
      targetPath,
      async () => ({ request: "message RequestMarker {}", response: "message ResponseMarker {}" })
    );
    expect(err).toBe("");
    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html).toContain("example.Service/Call");
    expect(html).toContain("1 Received (0.012 sec)");
    expect(html).toContain('>Executed</span> example.Service/Call<span class="tag is-primary is-light">RPC Result</span> OK(0) · 1 Received (0.012 sec)');
    expect(html).toContain('<span class="tag is-primary is-light">RPC Result</span> OK(0) · 1 Received (0.012 sec)');
    expect(html).not.toContain("Last execution response");
    expect(html).toContain("x-test");
    expect(html).toContain('<p class="subtitle is-6">unary example.Service/Call</p>');
    expect(html).toContain('data-tab="metadata" data-id-class="id0_request_tab"');
    expect(html).toContain('data-tab="descriptor" data-id-class="id0_request_tab"');
    expect(html).toContain('id="id0_request_tab-metadata" class="block id0_request_tab" style="display:none;"');
    expect(html).toContain('id="id0_request_tab-descriptor" class="block id0_request_tab" style="display:none;"');
    expect(html).toContain("x-id");
    expect(html).toContain("RequestMarker");
    expect(html).toContain("ResponseMarker");
    expect(html).not.toContain("Cell input at export time");
    expect(html).toContain('data-tab="data" data-id-class="id0_0_rpc_tab"');
    expect(html).toContain('id="id0_0_rpc_tab-data" class="block id0_0_rpc_tab"');
    expect(html).toContain('id="id0_0_rpc_tab-headers" class="block id0_0_rpc_tab" style="display:none;"');
    expect(html).toContain('id="id0_0_rpc_tab-trailers" class="block id0_0_rpc_tab" style="display:none;"');
    expect(html).toContain('id="id0_0_rpc_tab-descriptor" class="block id0_0_rpc_tab" style="display:none;"');
    expect(html).toContain("No trailers");
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain("u0060");
    expect(html).not.toContain('```&lt;script&gt;');
    expect(html).not.toContain("plain summary marker");
    expect(html).toContain('lang":"json"');
  });

  it("uses the existing report template for a panel RPC result", async () => {
    const targetPath = tmpHtmlPath();
    const err = await createHtmlFromRpcResult({
      connectionName: "rpc", service: "example.Service", method: "Stream", path: "/example.Service/Stream",
      inputType: "example.Request", outputType: "example.Response", discovery: "advertised",
      requestStream: true, responseStream: true, requestTemplate: "{}",
      requestDescription: "message PanelRequest {}", responseDescription: "message PanelResponse {}", requestDescriptionHtml: "", responseDescriptionHtml: "",
    }, '[{"value":"one"}]', {
      version: 1, kind: "response", cellId: "panel", outcome: "cancelled", elapsedMs: 42,
      sentCount: 2, receivedCount: 1,
      messages: [{ index: 1, at: 1000, contents: { value: "reply" } }], droppedCount: 1,
    }, targetPath, 1, '{"x-trace":"abc"}');
    expect(err).toBe("");
    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html).toContain("earlier sent messages omitted");
    expect(html).toContain("older messages omitted");
    expect(html).toContain("2 Sent, 1 Received (0.042 sec)");
    expect(html).toContain("reply");
    expect(html).toContain("PanelRequest");
    expect(html).toContain("PanelResponse");
    expect(html).toContain('<p class="subtitle is-6">bidiStreaming example.Service/Stream</p>');
    expect(html).toContain("x-trace");
    expect(html).toContain('>Cancelled</span> example.Service/Stream<span class="tag is-primary is-light">RPC Result</span> 2 Sent, 1 Received (0.042 sec)');
    expect(html).toContain('data-tab="trailers" data-id-class="id0_0_rpc_tab"');
    expect(html).toContain("No headers");
  });

  it("isolates RPC response tabs for separate cells", async () => {
    const targetPath = tmpHtmlPath();
    const result = {
      version: 1, kind: "response", cellId: "rpc", outcome: "success",
      elapsedMs: 1, receivedCount: 1, contents: { ok: true },
    };
    const cell = {
      kind: 2,
      document: { languageId: "rpc-json", getText: () => "{}" },
      metadata: {},
      outputs: [{ items: [{ mime: RPC_RESPONSE_MIME, data: Buffer.from(JSON.stringify(result)) }] }],
    };
    const err = await createHtmlFromNotebook(
      { getCells: () => [cell, cell] } as never,
      targetPath,
      async () => { throw new Error("schema unavailable"); }
    );
    expect(err).toBe("");
    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html).toContain('data-id-class="id0_0_rpc_tab"');
    expect(html).toContain('data-id-class="id1_0_rpc_tab"');
    expect(html).toContain('id="id0_0_rpc_tab-headers"');
    expect(html).toContain('id="id1_0_rpc_tab-headers"');
    expect(html).toContain("Descriptor unavailable");
  });
  it("DBN専用の目次セルをHTMLの目次と本文には重複出力しない", async () => {
    const targetPath = tmpHtmlPath();
    const dbnTocCell = {
      document: {
        languageId: "markdown",
        getText: () => "# Performance Tuning AI Analysis\n\n## Table of contents",
      },
      metadata: { excludeFromHtml: true },
      outputs: [],
    };
    const overviewCell = {
      document: {
        languageId: "markdown",
        getText: () => "## 1. Overview",
      },
      metadata: {},
      outputs: [],
    };
    const notebook = {
      getCells: () => [dbnTocCell, overviewCell],
    };

    const err = await createHtmlFromNotebook(notebook as never, targetPath);
    expect(err).toBe("");

    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html).not.toContain("Performance Tuning AI Analysis");
    expect(html).not.toContain("Table of contents");
    expect(html).toContain("1. Overview");
    expect(html).toContain('var numOfContents = 1;');
    expect(html).not.toContain('href="#cell2"');
  });

  it("renders a labeled JSON cell as plain text in both the TOC and its heading", async () => {
    const targetPath = tmpHtmlPath();
    const jsonCell = {
      document: {
        languageId: "json",
        getText: () => '{"formatVersion":1}',
      },
      metadata: { cellLabel: "Full context JSON" },
      outputs: [],
    };
    const notebook = {
      getCells: () => [jsonCell],
    };

    const err = await createHtmlFromNotebook(notebook as never, targetPath);
    expect(err).toBe("");

    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html).toContain('<a name="cell1">CELL1</a>');
    expect(html).toContain('<h5 class="subtitle is-5">Full context JSON</h5>');
    expect(html).toContain(
      '<span class="tag is-info is-light">json</span><span class="tag is-info is-light">Not executed</span> Full context JSON'
    );
    expect(html).not.toContain('<span class="tag is-info is-light">Full context JSON</span>');
  });

  it("shows a custom RdhSummary.info verbatim in the Query Result heading (DynamoDB-style text unmodified)", async () => {
    // design doc misc/specs/dynamodb-rdh-summary-display-improvement-plan.ja.md
    // §8.1: the HTML report must not add DynamoDB/RDB display branching of
    // its own - whatever RdhSummary.info holds is escaped and shown as-is.
    const rdh = ResultSetDataBuilder.createEmpty().build();
    rdh.meta.type = "select";
    rdh.summary = {
      info: "38 items returned • 90 ms • Capacity not reported",
    } as never;

    const targetPath = tmpHtmlPath();
    const sqlCell = {
      document: { languageId: "sql", getText: () => "SELECT * FROM MassiveRecords" },
      metadata: {},
      outputs: [
        {
          items: [],
          metadata: { rdh, status: "executed" },
        },
      ],
    };
    const notebook = {
      getCells: () => [sqlCell],
    };

    const err = await createHtmlFromNotebook(notebook as never, targetPath);
    expect(err).toBe("");

    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html).toContain("38 items returned • 90 ms • Capacity not reported");
    expect(html).toContain('<span class="tag is-primary is-light">Query Result</span>');
  });

  it("leaves the existing RDB-generated info (e.g. rows in set) unchanged", async () => {
    const rdh = ResultSetDataBuilder.createEmpty().build();
    rdh.meta.type = "select";
    rdh.summary = { info: "5 rows in set (0.01 sec)" } as never;

    const targetPath = tmpHtmlPath();
    const sqlCell = {
      document: { languageId: "sql", getText: () => "SELECT * FROM users" },
      metadata: {},
      outputs: [
        {
          items: [],
          metadata: { rdh, status: "executed" },
        },
      ],
    };
    const notebook = {
      getCells: () => [sqlCell],
    };

    const err = await createHtmlFromNotebook(notebook as never, targetPath);
    expect(err).toBe("");

    const html = await fs.promises.readFile(targetPath, "utf8");
    expect(html).toContain("5 rows in set (0.01 sec)");
  });
});
