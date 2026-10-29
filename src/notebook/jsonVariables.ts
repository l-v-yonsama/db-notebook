const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALUE_PLACEHOLDER = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

export const getSharedVariable = (name: string, variables: Record<string, unknown>): unknown => {
  if (!VARIABLE_NAME.test(name) || !Object.prototype.hasOwnProperty.call(variables, name)) {
    throw new Error(`Shared variable "${name}" is not defined.`);
  }
  return variables[name];
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

export const resolveJsonTemplate = (
  source: string,
  variables: Record<string, unknown>
): { value: unknown; json: string; substituted: boolean } => {
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
  let substituted = false;
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") {
      const match = VALUE_PLACEHOLDER.exec(value);
      if (match) {
        substituted = true;
        return cloneJsonVariable(getSharedVariable(match[1], variables), match[1]);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(replace);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    }
    return value;
  };
  const value = replace(parsed);
  return { value, json: JSON.stringify(value), substituted };
};
