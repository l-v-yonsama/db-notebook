const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const URL_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const VALUE_PLACEHOLDER = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

const getVariable = (name: string, variables: Record<string, unknown>): unknown => {
  if (!VARIABLE_NAME.test(name) || !Object.prototype.hasOwnProperty.call(variables, name)) {
    throw new Error(`Shared variable "${name}" is not defined.`);
  }
  return variables[name];
};

export const resolveRestUrlTemplate = (
  template: string,
  variables: Record<string, unknown>
): string => {
  const resolved = template.replace(URL_PLACEHOLDER, (_match, name: string) => {
    const value = getVariable(name, variables);
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      return String(value);
    }
    throw new Error(`Shared variable "${name}" must be a string or finite number in a URL.`);
  });
  if (resolved.includes("{{") || resolved.includes("}}")) {
    throw new Error("Invalid or unresolved URL variable. Use {{ name }}.");
  }
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

const cloneJsonVariable = (value: unknown, name: string, seen = new Set<object>()): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`Shared variable "${name}" is not a JSON value.`);
  }
  if (seen.has(value)) {
    throw new Error(`Shared variable "${name}" contains a circular reference.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => cloneJsonVariable(item, name, seen));
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error(`Shared variable "${name}" is not a JSON object.`);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonVariable(item, name, seen)])
    );
  } finally {
    seen.delete(value);
  }
};

export const resolveRestJsonBody = (
  source: string,
  variables: Record<string, unknown>
): string | undefined => {
  if (!source.trim()) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    if (/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/.test(source)) {
      throw new Error(
        'Invalid JSON. Write a variable as a JSON string, for example "{{ height }}".'
      );
    }
    throw error;
  }
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") {
      const match = VALUE_PLACEHOLDER.exec(value);
      return match ? cloneJsonVariable(getVariable(match[1], variables), match[1]) : value;
    }
    if (Array.isArray(value)) {
      return value.map(replace);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    }
    return value;
  };
  return JSON.stringify(replace(parsed));
};
