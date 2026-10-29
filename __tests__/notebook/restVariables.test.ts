import { describe, expect, it } from "vitest";
import { resolveRestJsonBody, resolveRestUrlTemplate } from "../../src/notebook/restVariables";

describe("REST JSON shared variables", () => {
  it("resolves URL parts and a whole URL from the current execution variables", () => {
    const vars = {
      protocol: "https",
      host: "example.com",
      port: 8080,
      prefix: "https://example.com/v1",
    };
    expect(resolveRestUrlTemplate("{{ protocol }}://{{host}}:{{port}}/customers", vars)).toBe(
      "https://example.com:8080/customers"
    );
    expect(resolveRestUrlTemplate("{{ prefix }}/customers", vars)).toBe(
      "https://example.com/v1/customers"
    );
    expect(() => resolveRestUrlTemplate("https://{{missing}}/", vars)).toThrow("missing");
  });

  it("keeps JSON types and escapes string values without changing the source", () => {
    const source =
      '{"parentId":"{{ parentId }}","height":"{{ height }}","enabled":"{{ enabled }}"}';
    expect(
      JSON.parse(
        resolveRestJsonBody(source, {
          parentId: 'a"b',
          height: 180,
          enabled: true,
        })!
      )
    ).toEqual({ parentId: 'a"b', height: 180, enabled: true });
    expect(source).toContain('"{{ height }}"');
    expect(() => resolveRestJsonBody('{"height":{{ height }}}', { height: 180 })).toThrow(
      '"{{ height }}"'
    );
  });
});
