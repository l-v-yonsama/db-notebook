<script setup lang="ts">
import { computed, ref } from "vue";
import type { RestCellRequestSettingsPanelEventData } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextArea from "./base/VsCodeTextArea.vue";

const method = ref("GET");
const url = ref("");
const headersJson = ref("{}");
const timeoutMs = ref(30000);
const notice = ref("");
const validationError = computed(() => {
  try {
    const parsed = JSON.parse(headersJson.value.trim() || "{}");
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.entries(parsed).some(
        ([name, value]) =>
          !name || typeof value !== "string" || /[\r\n]/.test(name) || /[\r\n]/.test(value)
      )
    ) {
      return "Headers must be a JSON object with single-line string values.";
    }
    if (!Number.isSafeInteger(timeoutMs.value) || timeoutMs.value < 0) {
      return "Timeout must be a non-negative integer.";
    }
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});

const save = () => {
  if (validationError.value) return;
  notice.value = "Saving…";
  vscode.postMessage({
    command: "saveRestCellSettings",
    params: {
      headersJson: headersJson.value,
      timeoutMs: timeoutMs.value,
    },
  });
};
const receiveMessage = (data: RestCellRequestSettingsPanelEventData) => {
  if (data.command === "initialize") {
    method.value = data.value.method ?? "GET";
    url.value = data.value.url ?? "";
    headersJson.value = data.value.headersJson ?? "{}";
    timeoutMs.value = data.value.timeoutMs ?? 30000;
    notice.value = "";
  } else if (data.command === "saved") notice.value = "Saved";
  else if (data.command === "error")
    notice.value = data.value.error ?? "Could not save REST settings.";
};
defineExpose({ recieveMessage: receiveMessage });
</script>

<template>
  <section class="rest-settings">
    <PanelActionToolbar @cancel="vscode.postCommand({ command: 'cancel', params: {} })">
      <VsCodeButton :disabled="!!validationError" title="Save REST request settings" @click="save"
        >Save</VsCodeButton
      >
    </PanelActionToolbar>
    <p class="target">{{ method }} {{ url || "Set a URL in the cell status bar" }}</p>
    <fieldset>
      <legend>Headers</legend>
      <p>Request headers as a JSON object with string values.</p>
      <VsCodeTextArea
        id="rest-cell-headers"
        class="headers-editor"
        v-model="headersJson"
        :rows="10"
        placeholder="{}"
        title="Request headers"
      />
    </fieldset>
    <fieldset>
      <legend>Timeout (ms)</legend>
      <input v-model.number="timeoutMs" type="number" min="0" step="1" />
      <p>Default: 30000 ms. Enter 0 for no timeout.</p>
    </fieldset>
    <p>
      Headers and URL are saved in the notebook file. Sent values also appear in exported reports.
    </p>
    <p v-if="validationError" class="error">{{ validationError }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.rest-settings {
  padding: 12px;
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
.headers-editor {
  width: 100%;
  box-sizing: border-box;
}
input {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 5px 8px;
}
.error {
  color: var(--vscode-errorForeground);
}
</style>
