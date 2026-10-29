export const RPC_CAPTURE_LIMIT = 500;
export const RPC_CAPTURE_BYTES = 8 * 1024 * 1024;

export const redactRpcToken = (message: string, token?: string): string =>
  token ? message.split(token).join("[redacted]") : message;
