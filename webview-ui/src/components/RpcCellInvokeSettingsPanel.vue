<script setup lang="ts">
import { computed, ref } from "vue";
import type { RpcCellInvokeSettingsPanelEventData } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextArea from "./base/VsCodeTextArea.vue";

const connectionName = ref("");
const method = ref("");
const metadataJson = ref("{}");
const descriptor = ref("");
const errorMessage = ref("");
const loading = ref(true);

const metadataError = computed(() => {
  try {
    const parsed = metadataJson.value.trim() ? JSON.parse(metadataJson.value) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "Metadata must be a JSON object.";
    }
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});

const descriptorTokens = computed(() => {
  const source = descriptor.value;
  const pattern =
    /(\/\/[^\n]*|\b(?:message|enum|service|rpc|returns|repeated|optional|required|oneof|map)\b|\b(?:double|float|int32|int64|uint32|uint64|sint32|sint64|fixed32|fixed64|sfixed32|sfixed64|bool|string|bytes)\b|\b\d+\b)/g;
  const tokens: { text: string; kind: string }[] = [];
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) tokens.push({ text: source.slice(offset, index), kind: "" });
    const value = match[0];
    const kind = value.startsWith("//")
      ? "comment"
      : /^\d/.test(value)
      ? "number"
      : /^(message|enum|service|rpc|returns|repeated|optional|required|oneof|map)$/.test(value)
      ? "keyword"
      : "type";
    tokens.push({ text: value, kind });
    offset = index + value.length;
  }
  if (offset < source.length) tokens.push({ text: source.slice(offset), kind: "" });
  return tokens;
});

const save = () => {
  if (metadataError.value) return;
  errorMessage.value = "";
  vscode.postCommand({
    command: "saveRpcCellMetadata",
    params: { metadataJson: metadataJson.value },
  });
};

const receiveMessage = (data: RpcCellInvokeSettingsPanelEventData) => {
  if (data.command === "initialize") {
    connectionName.value = data.value.connectionName ?? "";
    method.value = data.value.method ?? "";
    metadataJson.value = data.value.metadataJson ?? "{}";
    descriptor.value = "";
    errorMessage.value = "";
    loading.value = true;
  } else if (data.command === "descriptor") {
    descriptor.value = data.value.descriptor ?? "";
    loading.value = false;
  } else if (data.command === "error") {
    errorMessage.value = data.value.error ?? "Could not load RPC settings.";
    loading.value = false;
  }
};

defineExpose({ recieveMessage: receiveMessage });
</script>

<template>
  <section class="rpc-cell-settings">
    <PanelActionToolbar
      cancel-label=""
      cancel-title="Close"
      @cancel="vscode.postCommand({ command: 'cancel', params: {} })"
    >
      <template #left>
        <VsCodeButton :disabled="!!metadataError" title="Save request metadata" @click="save"
          >Save</VsCodeButton
        >
      </template>
    </PanelActionToolbar>
    <p class="target">
      {{ connectionName || "Select an RPC connection" }} · {{ method || "Select an RPC method" }}
    </p>
    <fieldset>
      <legend>Metadata</legend>
      <p>Request metadata as a JSON object</p>
      <VsCodeTextArea
        id="rpc-cell-metadata"
        class="metadata-editor"
        v-model="metadataJson"
        :rows="8"
        placeholder="{}"
        title="RPC request metadata"
      />
      <p v-if="metadataError" class="error">{{ metadataError }}</p>
    </fieldset>
    <fieldset>
      <legend>Descriptor</legend>
      <div class="actions">
        <VsCodeButton
          title="Reload RPC schema"
          @click="vscode.postMessage({ command: 'reloadDescriptor' })"
          >Reload schema</VsCodeButton
        >
        <VsCodeButton
          title="Insert request template into cell"
          @click="vscode.postMessage({ command: 'insertRpcTemplate' })"
          >Insert request template</VsCodeButton
        >
      </div>
      <p v-if="loading">Loading descriptor…</p>
      <pre
        v-else
      ><span v-for="(token, index) in descriptorTokens" :key="index" :class="token.kind">{{ token.text }}</span></pre>
    </fieldset>
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.rpc-cell-settings {
  padding: 12px;
  width: 100%;
  box-sizing: border-box;
}
.target {
  color: var(--vscode-descriptionForeground);
  overflow-wrap: anywhere;
}
fieldset {
  border: 1px solid var(--vscode-panel-border);
  margin: 12px 0;
  padding: 12px;
}
legend {
  font-weight: 600;
}
.metadata-editor {
  width: 100%;
  box-sizing: border-box;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
pre {
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
}
.error {
  color: var(--vscode-errorForeground);
}
.comment {
  color: var(--vscode-descriptionForeground);
}
.keyword {
  color: var(--vscode-symbolIcon-keywordForeground, #c586c0);
}
.type {
  color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
}
.number {
  color: var(--vscode-symbolIcon-numberForeground, #b5cea8);
}
</style>
