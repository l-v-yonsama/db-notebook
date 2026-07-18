export const ConnectionEnvironment = {
  Local: "local",
  Development: "development",
  Test: "test",
  Staging: "staging",
  Production: "production",
} as const;

export type ConnectionEnvironment = (typeof ConnectionEnvironment)[keyof typeof ConnectionEnvironment];

export const ConnectionEnvironmentValues = Object.values(ConnectionEnvironment);
