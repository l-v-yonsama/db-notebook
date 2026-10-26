import type {
  RpcFieldType,
  RpcMessage,
  RpcMethod,
} from "@l-v-yonsama/multi-platform-database-drivers";

const scalarValue = (scalar: string): number | boolean | string => {
  if (scalar === "bool") return false;
  if (scalar === "string" || scalar === "bytes") return "";
  if (["int64", "uint64", "sint64", "fixed64", "sfixed64"].includes(scalar)) return "0";
  return 0;
};

const wellKnownValue = (typeName: string): unknown => {
  switch (typeName) {
    case "google.protobuf.Timestamp":
      return "1970-01-01T00:00:00Z";
    case "google.protobuf.Duration":
      return "0s";
    case "google.protobuf.FieldMask":
    case "google.protobuf.StringValue":
    case "google.protobuf.BytesValue":
      return "";
    case "google.protobuf.DoubleValue":
    case "google.protobuf.FloatValue":
    case "google.protobuf.Int32Value":
    case "google.protobuf.UInt32Value":
      return 0;
    case "google.protobuf.Int64Value":
    case "google.protobuf.UInt64Value":
      return "0";
    case "google.protobuf.BoolValue":
      return false;
    case "google.protobuf.Struct":
      return {};
    case "google.protobuf.ListValue":
      return [];
    case "google.protobuf.Value":
    case "google.protobuf.Any":
      return null;
    default:
      return undefined;
  }
};

const typeLabel = (type: RpcFieldType): string => {
  switch (type.kind) {
    case "scalar":
      return type.scalar;
    case "message":
    case "enum":
      return type.typeName;
    case "repeated":
      return `repeated ${typeLabel(type.element)}`;
    case "map":
      return `map<${type.key}, ${typeLabel(type.value)}>`;
  }
};

const referencedTypes = (type: RpcFieldType): RpcFieldType[] => {
  if (type.kind === "repeated") return referencedTypes(type.element);
  if (type.kind === "map") return referencedTypes(type.value);
  return type.kind === "message" || type.kind === "enum" ? [type] : [];
};

const describeRpcMessage = (
  root: RpcMessage | undefined,
  typeName: string,
  byName: Map<string, RpcMessage>
): string => {
  if (!root) {
    return `// ${typeName}: definition unavailable`;
  }
  byName.set(root.fullName, root);
  const declarations: string[] = [];
  const seenMessages = new Set<string>();
  const enums = new Map<string, Record<string, number>>();
  const describeMessage = (message: RpcMessage): void => {
    if (seenMessages.has(message.fullName)) {
      return;
    }
    seenMessages.add(message.fullName);
    const fields = [...message.children].sort((a, b) => a.fieldNumber - b.fieldNumber);
    const seenOneofs = new Set<string>();
    const declarationFields = fields.flatMap((field) => {
      const line = (indent: string, item: typeof field): string => {
        const label = item.proto3Optional ? "optional " : item.required ? "required " : "";
        const options = [
          ...(item.deprecated ? ["deprecated = true"] : []),
          ...(item.jsonNameOption ? [`json_name = ${JSON.stringify(item.jsonNameOption)}`] : []),
        ];
        const optionText = options.length ? ` [${options.join(", ")}]` : "";
        return `${indent}${label}${typeLabel(item.fieldType)} ${item.name} = ${
          item.fieldNumber
        }${optionText};`;
      };
      if (!field.oneofGroup) {
        return [line("  ", field)];
      }
      if (seenOneofs.has(field.oneofGroup)) {
        return [];
      }
      seenOneofs.add(field.oneofGroup);
      const members = fields.filter((item) => item.oneofGroup === field.oneofGroup);
      return [
        `  oneof ${field.oneofGroup} {\n${members
          .map((item) => line("    ", item))
          .join("\n")}\n  }`,
      ];
    });
    declarations.push(
      `// ${message.fullName}\nmessage ${message.name} {\n${declarationFields.join("\n")}\n}`
    );
    for (const field of fields) {
      for (const type of referencedTypes(field.fieldType)) {
        if (type.kind === "message") {
          const nested = byName.get(type.typeName);
          if (nested) {
            describeMessage(nested);
          }
        } else if (type.kind === "enum") {
          enums.set(type.typeName, type.values);
        }
      }
    }
  };
  describeMessage(root);
  for (const [fullName, values] of enums) {
    const name = fullName.split(".").at(-1);
    declarations.push(
      `// ${fullName}\nenum ${name} {\n${Object.entries(values)
        .map(([key, value]) => `  ${key} = ${value};`)
        .join("\n")}\n}`
    );
  }
  return declarations.join("\n\n");
};

export function buildRpcResponseDescription(method: RpcMethod, definitions: RpcMessage[]): string {
  const byName = new Map(definitions.map((message) => [message.fullName, message]));
  const response =
    method.children.find((message) => message.direction === "response") ??
    byName.get(method.outputType);
  return describeRpcMessage(response, method.outputType, byName);
}

export function buildRpcRequestTemplate(
  method: RpcMethod,
  definitions: RpcMessage[]
): { data: string; description: string } {
  const byName = new Map(definitions.map((message) => [message.fullName, message]));
  const request =
    method.children.find((message) => message.direction === "request") ??
    byName.get(method.inputType);
  if (!request) {
    return { data: "{}", description: `// ${method.inputType}: definition unavailable` };
  }
  byName.set(request.fullName, request);

  const sampleValue = (type: RpcFieldType, ancestors: Set<string>): unknown => {
    switch (type.kind) {
      case "scalar":
        return scalarValue(type.scalar);
      case "enum":
        if (type.typeName === "google.protobuf.NullValue") return null;
        return (
          Object.entries(type.values).find(([, number]) => number === 0)?.[0] ??
          Object.keys(type.values)[0] ??
          ""
        );
      case "repeated":
        return [];
      case "map":
        return {};
      case "message": {
        const known = wellKnownValue(type.typeName);
        if (known !== undefined) return known;
        const nested = byName.get(type.typeName);
        if (!nested || ancestors.has(type.typeName)) return {};
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(type.typeName);
        return sampleMessage(nested, nextAncestors);
      }
    }
  };
  const sampleMessage = (message: RpcMessage, ancestors: Set<string>): unknown => {
    const known = wellKnownValue(message.fullName);
    if (known !== undefined) return known;
    const seenOneofs = new Set<string>();
    return Object.fromEntries(
      message.children
        .filter((field) => {
          if (!field.oneofGroup) return true;
          if (seenOneofs.has(field.oneofGroup)) return false;
          seenOneofs.add(field.oneofGroup);
          return true;
        })
        .map((field) => [field.jsonName ?? field.name, sampleValue(field.fieldType, ancestors)])
    );
  };
  const data = JSON.stringify(sampleMessage(request, new Set([request.fullName])), null, 2);

  return { data, description: describeRpcMessage(request, method.inputType, byName) };
}
