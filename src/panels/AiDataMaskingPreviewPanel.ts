import { randomUUID } from "crypto";
import type { CancellationToken, WebviewPanel } from "vscode";
import { Uri, ViewColumn, window } from "vscode";
import type { ActionCommand } from "../shared/ActionParams";
import type { AiPayloadFindingResolution, PreparedAiPayload } from "../shared/AiDataMasking";
import type { ComponentName } from "../shared/ComponentName";
import type { AiDataMaskingPreviewPanelEventData } from "../shared/MessageEventData";
import { AI_APPROVAL_TIMEOUT_MS } from "../utilities/aiDataMasking";
import { BasePanel } from "./BasePanel";

export type AiPayloadPreparer = (
  resolutions: ReadonlyMap<string, AiPayloadFindingResolution>,
  identity: { requestId: string; expiresAt: number }
) => PreparedAiPayload;

type PendingApproval = {
  prepare: AiPayloadPreparer;
  prepared: PreparedAiPayload;
  resolutions: Map<string, AiPayloadFindingResolution>;
  timer: ReturnType<typeof setTimeout>;
  cancellationDisposable?: { dispose(): void };
  abortCleanup?: () => void;
  resolve: (payload: string | undefined) => void;
};

let extensionUri: Uri | undefined;
let queueTail: Promise<void> = Promise.resolve();

export function configureAiDataMaskingPreview(uri: Uri): void {
  extensionUri = uri;
}

export async function requestAiPayloadApproval(
  prepare: AiPayloadPreparer,
  cancellation?: CancellationToken | AbortSignal
): Promise<string | undefined> {
  const expiresAt = Date.now() + AI_APPROVAL_TIMEOUT_MS;
  const previous = queueTail;
  let release!: () => void;
  queueTail = previous.then(() => new Promise<void>((resolve) => (release = resolve)));
  await previous;
  try {
    if (!extensionUri || Date.now() >= expiresAt || isCancelled(cancellation)) {
      return undefined;
    }
    return await AiDataMaskingPreviewPanel.open(extensionUri, prepare, expiresAt, cancellation);
  } finally {
    release();
  }
}

function isCancelled(value?: CancellationToken | AbortSignal): boolean {
  return Boolean(
    value && ("isCancellationRequested" in value ? value.isCancellationRequested : value.aborted)
  );
}

export class AiDataMaskingPreviewPanel extends BasePanel {
  private pending: PendingApproval | undefined;
  private finished = false;

  private constructor(panel: WebviewPanel, uri: Uri) {
    super(panel, uri);
  }

  static async open(
    uri: Uri,
    prepare: AiPayloadPreparer,
    expiresAt: number,
    cancellation?: CancellationToken | AbortSignal
  ): Promise<string | undefined> {
    const webviewPanel = window.createWebviewPanel(
      "AiDataMaskingPreviewPanelType",
      "AI Data Masking Preview",
      ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [Uri.joinPath(uri, "out"), Uri.joinPath(uri, "webview-ui/build")],
      }
    );
    const panel = new AiDataMaskingPreviewPanel(webviewPanel, uri);
    return await panel.start(prepare, expiresAt, cancellation);
  }

  getComponentName(): ComponentName {
    return "AiDataMaskingPreviewPanel";
  }

  private async start(
    prepare: AiPayloadPreparer,
    expiresAt: number,
    cancellation?: CancellationToken | AbortSignal
  ): Promise<string | undefined> {
    const identity = { requestId: randomUUID(), expiresAt };
    const prepared = prepare(new Map(), identity);
    return await new Promise<string | undefined>((resolve) => {
      const pending: PendingApproval = {
        prepare,
        prepared,
        resolutions: new Map(),
        timer: setTimeout(() => {
          this.finish(undefined);
          void window.showWarningMessage("The AI send preview expired after 5 minutes.");
        }, Math.max(0, expiresAt - Date.now())),
        resolve,
      };
      this.pending = pending;
      if (cancellation) {
        if ("onCancellationRequested" in cancellation) {
          pending.cancellationDisposable = cancellation.onCancellationRequested(() =>
            this.finish(undefined)
          );
        } else {
          const listener = () => this.finish(undefined);
          cancellation.addEventListener("abort", listener, { once: true });
          pending.abortCleanup = () => cancellation.removeEventListener("abort", listener);
        }
      }
      if (isCancelled(cancellation)) {
        this.finish(undefined);
      }
    });
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    switch (message.command) {
      case "ready":
        try {
          await this.post(pending.prepared);
        } catch {
          this.finish(undefined);
        }
        break;
      case "resolveAiPayloadFinding": {
        if (message.params.requestId !== pending.prepared.requestId) {
          return;
        }
        if (message.params.allCandidates) {
          pending.prepared.findings
            .filter((finding) => finding.disposition === "unreviewed")
            .forEach((finding) => pending.resolutions.set(finding.id, message.params.resolution));
        } else if (message.params.findingId) {
          pending.resolutions.set(message.params.findingId, message.params.resolution);
        }
        pending.prepared = pending.prepare(pending.resolutions, {
          requestId: pending.prepared.requestId,
          expiresAt: pending.prepared.expiresAt,
        });
        await this.post(pending.prepared);
        break;
      }
      case "approveAiPayload":
        if (
          message.params.requestId === pending.prepared.requestId &&
          message.params.payloadDigest === pending.prepared.payloadDigest &&
          Date.now() < pending.prepared.expiresAt &&
          pending.prepared.findings.every((finding) => finding.disposition !== "unreviewed")
        ) {
          this.finish(pending.prepared.payload);
        }
        break;
      case "cancelAiPayload":
      case "cancel":
        this.finish(undefined);
        break;
    }
  }

  private async post(prepared: PreparedAiPayload): Promise<void> {
    const message: AiDataMaskingPreviewPanelEventData = {
      command: "ai-send-preview",
      componentName: "AiDataMaskingPreviewPanel",
      value: { aiSendPreview: prepared },
    };
    await this.getWebviewPanel().webview.postMessage(message);
  }

  private finish(payload: string | undefined, closePanel = true): void {
    const pending = this.pending;
    if (!pending || this.finished) {
      return;
    }
    this.finished = true;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.cancellationDisposable?.dispose();
    pending.abortCleanup?.();
    pending.resolve(payload);
    if (closePanel) {
      this.getWebviewPanel().dispose();
    }
  }

  protected preDispose(): void {
    this.finish(undefined, false);
  }
}
