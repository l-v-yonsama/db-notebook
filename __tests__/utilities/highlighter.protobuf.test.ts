import { describe, expect, it } from "vitest";
import { createCodeHtmlStringSync } from "../../src/utilities/highlighter";

describe("protobuf highlighting", () => {
  it("colors schema tokens and escapes source text before HTML rendering", () => {
    const html = createCodeHtmlStringSync({
      code: "message Example {\n  string value = 1; // <img src=x onerror=alert(1)>\n}",
      lang: "protobuf",
    });

    expect(html).toContain('<span class="token keyword">message</span>');
    expect(html).toContain('<span class="token number">1</span>');
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});
