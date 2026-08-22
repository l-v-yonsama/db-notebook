import { ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import type { Har } from "har-format";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createHtmlFromHarItem, createHtmlFromNotebook } from "../../src/utilities/htmlGenerator";

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
});
