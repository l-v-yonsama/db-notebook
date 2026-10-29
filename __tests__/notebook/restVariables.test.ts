import { describe, expect, it } from "vitest";
import {
  resolveRestHeaders,
  resolveRestJsonBody,
  resolveRestUrlTemplate,
} from "../../src/notebook/restVariables";

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

  it("resolves whole and embedded header values before sending", () => {
    const source =
      '{"Authorization":"Bearer {{ token }}","X-Request-Id":"{{ requestId }}","Accept":"application/json"}';
    expect(resolveRestHeaders(source, { token: "abc", requestId: 42 })).toEqual({
      Authorization: "Bearer abc",
      "X-Request-Id": "42",
      Accept: "application/json",
    });
    expect(JSON.parse(source).Authorization).toBe("Bearer {{ token }}");
  });

  it("rejects missing, invalid, and multiline header variables before sending", () => {
    expect(() => resolveRestHeaders('{"Authorization":"Bearer {{ missing }}"}', {})).toThrow(
      'Shared variable "missing" is not defined.'
    );
    expect(() => resolveRestHeaders('{"Authorization":"{{ token }}"}', { token: {} })).toThrow(
      'Shared variable "token" must be a string or finite number'
    );
    expect(() => resolveRestHeaders('{"Authorization":"Bearer {{ token }}"}', { token: "a\r\nb" })).toThrow(
      'Header "Authorization" must have a single-line string value.'
    );
    expect(() => resolveRestHeaders('{"Content-Type":"{{ type }}"}', { type: "text/plain" })).toThrow(
      "REST JSON only supports application/json request bodies."
    );
  });
});
