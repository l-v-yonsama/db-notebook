<script setup lang="ts">
import {
  vscode,
  type RpcInvokePanelEventData,
  type RpcInvokeRequest,
  type RpcInvokeResultView,
  type RpcInvokeTarget,
  type RpcStreamCompletedView,
  type RpcStreamEventView,
} from "@/utilities/vscode";
import { computed, ref } from "vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import VsCodeTextArea from "./base/VsCodeTextArea.vue";

type ResultTab = "data" | "headers" | "trailers" | "description";
type RequestTab = "data" | "metadata" | "description";

const target = ref<RpcInvokeTarget>();
const requestJson = ref("{}");
const metadataJson = ref("");
const result = ref<RpcInvokeResultView>();
const error = ref("");
const inProgress = ref(false);
const activeTab = ref<ResultTab>("data");
const activeRequestTab = ref<RequestTab>("data");
const isStreaming = computed(() => !!(target.value?.requestStream || target.value?.responseStream));
const streamSessionId = ref<string>();
const streamState = ref<"idle" | "connecting" | "open" | "sendingClosed" | "cancelling" | "completed" | "failed" | "cancelled" | "timeout">("idle");
const streamStateLabel = computed(() => ({
  idle: "Ready",
  connecting: "Connecting",
  open: "Open",
  sendingClosed: "Sending closed / Waiting",
  cancelling: "Cancelling",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  timeout: "Timeout",
}[streamState.value]));
const streamEvents = ref<RpcStreamEventView[]>([]);
const streamCompletion = ref<RpcStreamCompletedView["completion"]>();
const streamError = ref("");
const streamHeaders = ref<Record<string, string[]>>();
const streamSentCount = ref(0);
const streamReceivedCount = ref(0);
const streamBytes = ref(0);
const streamDropped = ref(0);
const streamLastSequence = ref(0);
type RpcMessageEventView = RpcStreamEventView & {
  event: Exclude<RpcStreamEventView["event"], { type: "headers" }>;
};
const messageEvents = computed(() =>
  streamEvents.value.filter((item): item is RpcMessageEventView => item.event.type !== "headers")
);

const parseObject = (text: string, label: string): Record<string, unknown> => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (parseError) {
    throw new Error(`${label} must be valid JSON: ${(parseError as Error).message}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
};

const parseMetadata = (): RpcInvokeRequest["metadata"] => {
  if (!metadataJson.value.trim()) {
    return undefined;
  }
  const value = parseObject(metadataJson.value, "Metadata");
  const metadata: Record<string, string | string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === "authorization") {
      throw new Error("Authorization metadata is managed by the connection setting.");
    }
    if (
      typeof item === "string" ||
      (Array.isArray(item) && item.every((part) => typeof part === "string"))
    ) {
      metadata[key] = item;
    } else {
      throw new Error(`Metadata ${key} must be a string or an array of strings.`);
    }
  }
  return metadata;
};

const invoke = (): void => {
  if (!target.value || inProgress.value) {
    return;
  }
  try {
    const params: RpcInvokeRequest = {
      connectionName: target.value.connectionName,
      service: target.value.service,
      method: target.value.method,
      requestJson: requestJson.value,
      metadata: parseMetadata(),
    };
    error.value = "";
    result.value = undefined;
    inProgress.value = true;
    vscode.postCommand({ command: "invokeRpc", params });
  } catch (validationError) {
    error.value =
      validationError instanceof Error ? validationError.message : String(validationError);
  }
};

const startStream = (): void => {
  if (!target.value || streamState.value === "connecting" || streamState.value === "open" || streamState.value === "sendingClosed") return;
  try {
    const params: RpcInvokeRequest = {
      connectionName: target.value.connectionName,
      service: target.value.service,
      method: target.value.method,
      requestJson: requestJson.value,
      metadata: parseMetadata(),
    };
    streamEvents.value = [];
    streamHeaders.value = undefined;
    streamSentCount.value = 0;
    streamReceivedCount.value = 0;
    streamBytes.value = 0;
    streamDropped.value = 0;
    streamLastSequence.value = 0;
    streamCompletion.value = undefined;
    streamError.value = "";
    streamSessionId.value = undefined;
    streamState.value = "connecting";
    vscode.postCommand({ command: "startRpcStream", params });
  } catch (validationError) {
    streamError.value = validationError instanceof Error ? validationError.message : String(validationError);
  }
};

const sendStreamMessage = (): void => {
  if (!streamSessionId.value || streamState.value !== "open") return;
  streamError.value = "";
  vscode.postCommand({
    command: "sendRpcStreamMessage",
    params: { sessionId: streamSessionId.value, requestJson: requestJson.value },
  });
};

const finishStreamSending = (): void => {
  if (!streamSessionId.value || streamState.value !== "open") return;
  streamState.value = "sendingClosed";
  vscode.postCommand({ command: "finishRpcStreamSending", params: { sessionId: streamSessionId.value } });
};

const cancelStream = (): void => {
  if (!streamSessionId.value || !["connecting", "open", "sendingClosed"].includes(streamState.value)) return;
  streamState.value = "cancelling";
  vscode.postCommand({ command: "cancelRpcStream", params: { sessionId: streamSessionId.value } });
};

const close = (): void => {
  vscode.postCommand({ command: "cancel", params: {} });
};

const recieveMessage = (message: RpcInvokePanelEventData): void => {
  if (message.command === "initialize" && message.value.initialize) {
    const next = message.value.initialize;
    if (
      target.value?.connectionName !== next.connectionName ||
      target.value?.path !== next.path ||
      target.value?.inputType !== next.inputType ||
      target.value?.outputType !== next.outputType ||
      target.value?.discovery !== next.discovery ||
      target.value?.requestStream !== next.requestStream ||
      target.value?.responseStream !== next.responseStream ||
      target.value?.requestTemplate !== next.requestTemplate ||
      target.value?.requestDescription !== next.requestDescription ||
      target.value?.responseDescription !== next.responseDescription
      || (next.restoreId !== undefined && target.value?.restoreId !== next.restoreId)
    ) {
      requestJson.value = next.restoredRequestJson ?? next.requestTemplate;
      metadataJson.value = "";
      result.value = undefined;
      error.value = "";
      activeTab.value = "data";
      activeRequestTab.value = "data";
      streamSessionId.value = undefined;
      streamState.value = "idle";
      streamEvents.value = [];
      streamHeaders.value = undefined;
      streamSentCount.value = 0;
      streamReceivedCount.value = 0;
      streamBytes.value = 0;
      streamDropped.value = 0;
      streamLastSequence.value = 0;
      streamCompletion.value = undefined;
      streamError.value = "";
    }
    target.value = next;
    inProgress.value = false;
  } else if (message.command === "result") {
    result.value = message.value.result;
    error.value = "";
    inProgress.value = false;
    activeTab.value = "data";
  } else if (message.command === "error") {
    error.value = message.value.error ?? "RPC invocation failed.";
    result.value = undefined;
    inProgress.value = false;
  } else if (message.command === "streamConnecting" && message.value.streamConnecting) {
    streamSessionId.value = message.value.streamConnecting.sessionId;
    streamState.value = "connecting";
  } else if (message.command === "streamStarted" && message.value.streamStarted) {
    streamSessionId.value = message.value.streamStarted.sessionId;
    streamState.value = "open";
  } else if (message.command === "streamEvent" && message.value.streamEvent) {
    const item = message.value.streamEvent;
    if (item.sessionId !== streamSessionId.value) return;
    if (item.sequence <= streamLastSequence.value) return;
    streamLastSequence.value = item.sequence;
    if (item.event.type === "headers") {
      streamHeaders.value = item.event.headers;
      return;
    }
    if (item.event.type === "sent") streamSentCount.value = Math.max(streamSentCount.value, item.event.index);
    else streamReceivedCount.value = Math.max(streamReceivedCount.value, item.event.index);
    streamEvents.value.push(item);
    streamBytes.value += new TextEncoder().encode(JSON.stringify(item)).length;
    while (streamEvents.value.length > 500 || streamBytes.value > 8 * 1024 * 1024) {
      const removed = streamEvents.value.shift();
      if (!removed) break;
      streamBytes.value -= new TextEncoder().encode(JSON.stringify(removed)).length;
      streamDropped.value += 1;
    }
  } else if (message.command === "streamCompleted" && message.value.streamCompleted) {
    if (message.value.streamCompleted.sessionId !== streamSessionId.value) return;
    streamCompletion.value = message.value.streamCompleted.completion;
    streamState.value = message.value.streamCompleted.completion.outcome === "success"
      ? "completed"
      : message.value.streamCompleted.completion.outcome === "error"
        ? "failed"
        : message.value.streamCompleted.completion.outcome;
    activeTab.value = "data";
  } else if (message.command === "streamError" && message.value.streamError) {
    const issue = message.value.streamError;
    if (issue.sessionId && issue.sessionId !== streamSessionId.value) return;
    streamError.value = issue.error;
    if (!issue.sessionId) streamState.value = issue.error.includes("cancelled") ? "cancelled" : "failed";
  }
};

defineExpose({ recieveMessage });
</script>

<template>
  <section class="RpcInvokePanel">
    <PanelActionToolbar cancel-label="" cancel-title="Close panel" @cancel="close">
      <template #left>
        <strong>{{ target?.connectionName ?? "RPC" }}</strong>
        <span class="method-name" :title="target?.path"
          >{{ target?.service }}/{{ target?.method }}</span
        >
      </template>
      <VsCodeButton v-if="!isStreaming" :disabled="!target || inProgress" title="Invoke unary RPC" @click="invoke">
        <fa icon="play" />{{ inProgress ? "Invoking..." : "Invoke" }}
      </VsCodeButton>
      <template v-else>
        <VsCodeButton
          v-if="['idle', 'completed', 'failed', 'cancelled', 'timeout'].includes(streamState)"
          :disabled="!target"
          :title="target?.requestStream ? 'Start RPC stream' : 'Invoke server stream'"
          @click="startStream"
        >
          <fa icon="play" />{{ target?.requestStream ? "Start" : "Invoke" }}
        </VsCodeButton>
        <VsCodeButton v-if="target?.requestStream && streamState === 'open'" title="Send one request message" @click="sendStreamMessage">Send</VsCodeButton>
        <VsCodeButton v-if="target?.requestStream && streamState === 'open'" title="Close the request side and wait for the response" @click="finishStreamSending">Finish Sending</VsCodeButton>
        <VsCodeButton v-if="['connecting', 'open', 'sendingClosed'].includes(streamState)" title="Cancel RPC stream" @click="cancelStream">Cancel</VsCodeButton>
      </template>
    </PanelActionToolbar>

    <div class="body">
      <fieldset class="pane request-pane">
        <legend>Request</legend>
        <div class="tabs request-tabs">
          <VsCodeTabHeader
            id="rpc-request-data"
            title="Data"
            :is-active="activeRequestTab === 'data'"
            :closable="false"
            @clicked="activeRequestTab = 'data'"
          />
          <VsCodeTabHeader
            id="rpc-request-metadata"
            title="Metadata"
            :is-active="activeRequestTab === 'metadata'"
            :closable="false"
            @clicked="activeRequestTab = 'metadata'"
          />
          <VsCodeTabHeader
            id="rpc-request-description"
            title="Description"
            :is-active="activeRequestTab === 'description'"
            :closable="false"
            @clicked="activeRequestTab = 'description'"
          />
        </div>
        <div v-if="activeRequestTab === 'data'" class="request-content">
          <label for="rpc-request">{{ isStreaming && target?.requestStream ? "Next request JSON" : "Request JSON" }}</label>
          <VsCodeTextArea
            id="rpc-request"
            v-model="requestJson"
            :rows="11"
            placeholder="{}"
            title="Request in ProtoJSON format"
          />
          <p class="hint">
            ProtoJSON: 64-bit integers use decimal strings in responses; safe numbers are accepted
            in requests. Timestamp and Duration use strings. Bytes use base64 strings.
          </p>
        </div>
        <div v-else-if="activeRequestTab === 'metadata'" class="request-content">
          <label for="rpc-metadata">Request metadata (JSON object, optional)</label>
          <VsCodeTextArea
            id="rpc-metadata"
            v-model="metadataJson"
            :rows="4"
            placeholder='{"x-request-id":"example"}'
            title="Text request metadata"
          />
        </div>
        <div v-else class="message-description" v-html="target?.requestDescriptionHtml"></div>
      </fieldset>

      <fieldset class="pane response-pane" v-if="target">
        <legend>
          Response
          <span v-if="result" class="response-status">
            · Status: {{ result.status.code }} {{ result.status.name }} · {{ result.elapsedMs }} ms
          </span>
          <span v-else-if="isStreaming && streamCompletion" class="response-status">
            · {{ streamCompletion.outcome }}
            <template v-if="streamCompletion.status"> · Status: {{ streamCompletion.status.code }} {{ streamCompletion.status.name }}</template>
            · {{ streamCompletion.elapsedMs }} ms
          </span>
        </legend>
        <p
          v-if="result?.status.details && result.status.details !== result.status.name"
          class="status-details"
        >
          {{ result.status.details }}
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="inProgress" role="status">Invoking RPC...</p>
        <p v-if="isStreaming && streamError" class="error" role="alert">{{ streamError }}</p>
        <p v-if="isStreaming" role="status">{{ streamStateLabel }} · Sent {{ streamCompletion?.sentCount ?? streamSentCount }} · Received {{ streamCompletion?.receivedCount ?? streamReceivedCount }}<span v-if="streamDropped"> · {{ streamDropped }} older rows removed</span></p>
        <p v-if="isStreaming && streamCompletion?.status?.details" class="status-details">{{ streamCompletion.status.details }}</p>
        <div class="tabs">
          <VsCodeTabHeader
            id="data"
            title="Data"
            :is-active="activeTab === 'data'"
            :closable="false"
            @clicked="activeTab = 'data'"
          />
          <VsCodeTabHeader
            id="headers"
            title="Headers"
            :is-active="activeTab === 'headers'"
            :closable="false"
            @clicked="activeTab = 'headers'"
          />
          <VsCodeTabHeader
            id="trailers"
            title="Trailers"
            :is-active="activeTab === 'trailers'"
            :closable="false"
            @clicked="activeTab = 'trailers'"
          />
          <VsCodeTabHeader
            id="rpc-response-description"
            title="Description"
            :is-active="activeTab === 'description'"
            :closable="false"
            @clicked="activeTab = 'description'"
          />
        </div>
        <div class="code" v-if="activeTab === 'data'">
          <template v-if="isStreaming">
            <div v-for="item in messageEvents" :key="item.sequence" class="stream-entry">
              <details>
                <summary>{{ item.event.type === 'sent' ? '→ Sent' : '← Received' }} #{{ item.event.index }} · {{ new Date(item.event.at).toLocaleTimeString() }}</summary>
                <pre>{{ JSON.stringify(item.event.contents, null, 2) }}</pre>
              </details>
            </div>
            <span v-if="!streamEvents.length">No messages yet</span>
          </template>
          <div v-else-if="result" v-html="result.contentsHtml"></div>
          <span v-else>No response yet</span>
        </div>
        <div class="code" v-else-if="activeTab === 'headers'">
          <pre v-if="isStreaming && streamHeaders">{{ JSON.stringify(streamHeaders, null, 2) }}</pre>
          <div v-else-if="result?.headersHtml" v-html="result.headersHtml"></div>
          <span v-else>{{ result || streamCompletion ? "No headers" : "No response yet" }}</span>
        </div>
        <div class="code" v-else-if="activeTab === 'trailers'">
          <pre v-if="isStreaming && streamCompletion?.trailers">{{ JSON.stringify(streamCompletion.trailers, null, 2) }}</pre>
          <div v-else-if="result?.trailersHtml" v-html="result.trailersHtml"></div>
          <span v-else>{{ result || streamCompletion ? "No trailers" : "No response yet" }}</span>
        </div>
        <div v-else class="message-description" v-html="target.responseDescriptionHtml"></div>
      </fieldset>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.RpcInvokePanel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;

  :deep(.tool-left) {
    min-width: 0;
    overflow: hidden;
  }

  .method-name {
    margin-left: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .body {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 12px;
  }

  .pane {
    border: 1px solid var(--vscode-panel-border);
    box-sizing: border-box;
    margin: 0;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    padding: 8px 12px 12px;
  }

  .pane legend {
    font-weight: 600;
    padding: 0 6px;
  }

  .response-status {
    font-weight: normal;
  }

  .status-details {
    color: var(--vscode-descriptionForeground);
    margin: 0 0 8px;
  }

  vscode-text-area {
    width: 100%;
  }

  .hint {
    color: var(--vscode-descriptionForeground);
    margin: 0;
  }

  .error {
    color: var(--vscode-errorForeground);
    white-space: pre-wrap;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
  }

  .request-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .message-description {
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    margin: 0;
    overflow: auto;
    white-space: pre;
  }

  .message-description :deep(pre.code-highlight) {
    font-size: inherit;
    margin: 0;
    padding: 0;
  }

  .message-description :deep(.token.builtin) {
    color: var(--vscode-charts-blue);
  }

  .message-description :deep(.token.annotation) {
    color: var(--vscode-charts-green);
  }

  .code {
    overflow: auto;
    min-height: 100px;
    white-space: pre;
    padding: 8px;
  }

  .stream-entry {
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 4px 0;
  }

  .stream-entry pre {
    margin: 6px 0 6px 18px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .code :deep(pre.code-highlight) {
    margin: 0;
  }

  @media (max-width: 850px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
      overflow: auto;
    }

    .pane {
      min-height: 240px;
      overflow: visible;
    }
  }
}
</style>
