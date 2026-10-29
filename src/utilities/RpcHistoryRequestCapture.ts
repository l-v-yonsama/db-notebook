import { createHash } from "crypto";

export const RPC_HISTORY_REQUEST_MAX_BYTES = 64 * 1024;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
};

/** Collects one RPC request without retaining unbounded streaming Data. */
export class RpcHistoryRequestCapture {
  private readonly hash = createHash("sha256");
  private readonly parts: string[] = [];
  private bytes = 0;
  private count = 0;
  private exceededLimit = false;

  constructor(private readonly requestStream: boolean) {
    if (requestStream) {
      this.hash.update("[");
      this.bytes = 2;
    }
  }

  add(requestJson: string): void {
    if (!this.requestStream && this.count > 0) {
      throw new Error("A non-streaming RPC request can contain only one message.");
    }
    const normalized = JSON.stringify(canonicalize(JSON.parse(requestJson)));
    const fragment = `${this.requestStream && this.count > 0 ? "," : ""}${normalized}`;
    this.hash.update(fragment);
    this.count++;
    this.bytes += Buffer.byteLength(fragment, "utf8");
    if (!this.exceededLimit && this.bytes <= RPC_HISTORY_REQUEST_MAX_BYTES) {
      this.parts.push(fragment);
    } else {
      this.exceededLimit = true;
      this.parts.length = 0;
    }
  }

  finish(): { requestDigest: string; requestJson?: string } {
    if (this.requestStream) {
      this.hash.update("]");
    }
    return {
      requestDigest: this.hash.digest("hex"),
      ...(!this.exceededLimit && (this.requestStream || this.count > 0) && {
        requestJson: this.requestStream ? `[${this.parts.join("")}]` : this.parts[0],
      }),
    };
  }
}
