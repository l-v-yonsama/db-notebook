import { GeneralColumnType } from "@l-v-yonsama/rdh";
import { RpcField, RpcMessage, RpcMethod } from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  buildRpcRequestTemplate,
  buildRpcResponseDescription,
} from "../../src/utilities/rpcRequestTemplate";

describe("RPC request template", () => {
  it("uses ProtoJSON field names and values for 64-bit and well-known types", () => {
    const method = new RpcMethod(
      "CreateTestTable",
      "/example.Service/CreateTestTable",
      "example.CreateTestTableRequest",
      "example.TestTable"
    );
    const request = method.addChild(
      new RpcMessage("CreateTestTableRequest", "example.CreateTestTableRequest", "request")
    );
    request.addChild(
      new RpcField(
        "test_table",
        1,
        { kind: "message", typeName: "example.TestTable" },
        GeneralColumnType.OBJECT,
        "explicit",
        undefined,
        "testTable"
      )
    );
    const table = new RpcMessage("TestTable", "example.TestTable");
    table.addChild(
      new RpcField(
        "int64_value",
        1,
        { kind: "scalar", scalar: "int64" },
        GeneralColumnType.BIGINT,
        "implicit",
        undefined,
        "int64Value"
      )
    );
    table.addChild(
      new RpcField(
        "timestamp_value",
        2,
        { kind: "message", typeName: "google.protobuf.Timestamp" },
        GeneralColumnType.OBJECT,
        "explicit",
        undefined,
        "timestampValue"
      )
    );
    table.addChild(
      new RpcField(
        "duration_value",
        3,
        { kind: "message", typeName: "google.protobuf.Duration" },
        GeneralColumnType.OBJECT,
        "explicit",
        undefined,
        "durationValue"
      )
    );
    table.addChild(
      new RpcField(
        "deprecated_string_value",
        4,
        { kind: "scalar", scalar: "string" },
        GeneralColumnType.TEXT,
        "implicit",
        undefined,
        "deprecatedStringValue",
        { deprecated: true }
      )
    );
    expect(JSON.parse(buildRpcRequestTemplate(method, [request, table]).data)).toEqual({
      testTable: {
        int64Value: "0",
        timestampValue: "1970-01-01T00:00:00Z",
        durationValue: "0s",
        deprecatedStringValue: "",
      },
    });
    expect(buildRpcRequestTemplate(method, [request, table]).description).toContain(
      "string deprecated_string_value = 4 [deprecated = true];"
    );
    expect(buildRpcResponseDescription(method, [request, table])).toContain(
      "string deprecated_string_value = 4 [deprecated = true];"
    );
  });

  it("selects one oneof field and stops at recursive messages", () => {
    const method = new RpcMethod(
      "Call",
      "/example.Service/Call",
      "example.Request",
      "example.Reply"
    );
    const request = method.addChild(new RpcMessage("Request", "example.Request", "request"));
    request.addChild(
      new RpcField(
        "choice_a",
        1,
        { kind: "scalar", scalar: "string" },
        GeneralColumnType.TEXT,
        "explicit",
        "choice"
      )
    );
    request.addChild(
      new RpcField(
        "choice_b",
        2,
        { kind: "scalar", scalar: "int32" },
        GeneralColumnType.INTEGER,
        "explicit",
        "choice"
      )
    );
    request.addChild(
      new RpcField(
        "nested",
        3,
        { kind: "message", typeName: "example.Nested" },
        GeneralColumnType.OBJECT,
        "explicit"
      )
    );
    const nested = new RpcMessage("Nested", "example.Nested");
    nested.addChild(
      new RpcField(
        "back",
        1,
        { kind: "message", typeName: "example.Nested" },
        GeneralColumnType.OBJECT,
        "explicit"
      )
    );
    const response = method.addChild(new RpcMessage("Reply", "example.Reply", "response"));
    response.addChild(
      new RpcField(
        "nested",
        1,
        { kind: "message", typeName: "example.Nested" },
        GeneralColumnType.OBJECT,
        "explicit"
      )
    );

    const view = buildRpcRequestTemplate(method, [request, nested]);
    expect(JSON.parse(view.data)).toEqual({ choice_a: "", nested: { back: {} } });
    expect(view.description).toContain("oneof choice {");
    expect(view.description).toContain("choice_b = 2;");
    expect(view.description.match(/message Nested/g)).toHaveLength(1);
    const responseDescription = buildRpcResponseDescription(method, [request, response, nested]);
    expect(responseDescription).toContain("message Reply {");
    expect(responseDescription).toContain("example.Nested nested = 1;");
    expect(responseDescription).toContain("message Nested {");
    expect(responseDescription).not.toContain("message Request {");
  });

  it("renders proto3 optional, required, and custom JSON names without a synthetic oneof", () => {
    const method = new RpcMethod(
      "Call",
      "/example.Service/Call",
      "example.Request",
      "example.Reply"
    );
    const request = method.addChild(new RpcMessage("Request", "example.Request", "request"));
    request.addChild(
      new RpcField(
        "optional_count",
        1,
        { kind: "scalar", scalar: "int32" },
        GeneralColumnType.INTEGER,
        "explicit",
        undefined,
        "optionalCount",
        { proto3Optional: true }
      )
    );
    request.addChild(
      new RpcField(
        "required_name",
        2,
        { kind: "scalar", scalar: "string" },
        GeneralColumnType.TEXT,
        "explicit",
        undefined,
        "requiredName",
        { required: true }
      )
    );
    request.addChild(
      new RpcField(
        "external_name",
        3,
        { kind: "scalar", scalar: "string" },
        GeneralColumnType.TEXT,
        "implicit",
        undefined,
        "wireName",
        { jsonNameOption: "wireName" }
      )
    );

    const description = buildRpcRequestTemplate(method, [request]).description;
    expect(description).toContain("optional int32 optional_count = 1;");
    expect(description).toContain("required string required_name = 2;");
    expect(description).toContain('string external_name = 3 [json_name = "wireName"];');
    expect(description).not.toContain("oneof _optional_count");
  });
});
