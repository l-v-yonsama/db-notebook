import { getSharedVariable, resolveJsonTemplate } from "./jsonVariables";

const STRING_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

const resolveStringTemplate = (
  template: string,
  variables: Record<string, unknown>,
  location: string
): string => {
  const resolved = template.replace(STRING_PLACEHOLDER, (_match, name: string) => {
    const value = getSharedVariable(name, variables);
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      return String(value);
    }
    throw new Error(`Shared variable "${name}" must be a string or finite number in ${location}.`);
  });
  if (resolved.includes("{{") || resolved.includes("}}")) {
    throw new Error(`Invalid or unresolved variable in ${location}. Use {{ name }}.`);
  }
  return resolved;
};

export const resolveRestUrlTemplate = (
  template: string,
  variables: Record<string, unknown>
): string => {
  const resolved = resolveStringTemplate(template, variables, "a URL");
  let parsed: URL;
  try {
    parsed = new URL(resolved);
  } catch {
    throw new Error("REST URL must be an absolute HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("REST URL must use HTTP or HTTPS.");
  }
  return resolved;
};

export const resolveRestHeaders = (
  source: string,
  variables: Record<string, unknown>
): Record<string, string> => {
  let value: unknown;
  try {
    value = JSON.parse(source.trim() || "{}");
  } catch {
    throw new Error("Headers must be a JSON object with string values.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Headers must be a JSON object with string values.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      if (typeof item !== "string" || !name || /[\r\n]/.test(name)) {
        throw new Error(`Header "${name}" must have a single-line string value.`);
      }
      const resolved = resolveStringTemplate(item, variables, `header "${name}"`);
      if (/[\r\n]/.test(resolved)) {
        throw new Error(`Header "${name}" must have a single-line string value.`);
      }
      if (
        name.toLowerCase() === "content-type" &&
        !/^application\/json(?:\s*;|\s*$)/i.test(resolved)
      ) {
        throw new Error("REST JSON only supports application/json request bodies.");
      }
      return [name, resolved];
    })
  );
};

export const resolveRestJsonBody = (
  source: string,
  variables: Record<string, unknown>
): string | undefined => {
  if (!source.trim()) {
    return undefined;
  }
  return resolveJsonTemplate(source, variables).json;
};
