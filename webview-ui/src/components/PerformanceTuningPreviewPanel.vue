<script setup lang="ts">
import type { PerformanceTuningPreviewPanelEventData } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { computed, ref } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import VsCodeButton from "./base/VsCodeButton.vue";

const context = ref<PerformanceTuningContext | undefined>(undefined);
const sqlHtml = ref("");
const jsonHtml = ref("");
const payloadBytes = ref(0);
const maxPayloadBytes = ref(0);

// Only used for the "Copy JSON" button (needs plain text, not the
// highlighted HTML) - kept in sync with what the extension side rendered
// into jsonHtml since both stringify the same context with the same args.
const contextJson = computed(() => (context.value ? JSON.stringify(context.value, null, 2) : ""));

const payloadExceeded = computed(
  () => maxPayloadBytes.value > 0 && payloadBytes.value > maxPayloadBytes.value
);

const initialize = (v: PerformanceTuningPreviewPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  context.value = v.context;
  sqlHtml.value = v.sqlHtml;
  jsonHtml.value = v.jsonHtml;
  payloadBytes.value = v.payloadBytes;
  maxPayloadBytes.value = v.maxPayloadBytes;
};

const recieveMessage = (data: PerformanceTuningPreviewPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      initialize(value.initialize);
      break;
  }
};

const close = (): void => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="PerformanceTuningPreviewPanel" v-if="context">
    <div class="header">
      <div class="row">
        <span class="label">Database</span>
        <span>{{ context.database.vendor }}{{ context.database.version ? ` ${context.database.version}` : "" }} ・
          {{ context.database.databaseName }}<span v-if="context.database.schemaName">.{{ context.database.schemaName }}</span></span>
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="badge" :class="context.collection.status">{{ context.collection.status }}</span>
      </div>
      <div class="row">
        <span class="label">Payload size</span>
        <span :class="{ exceeded: payloadExceeded }">
          {{ payloadBytes.toLocaleString() }} / {{ maxPayloadBytes.toLocaleString() }} bytes
          <span v-if="payloadExceeded">(exceeds limit)</span>
        </span>
      </div>
      <div class="row sql">
        <span class="label">SQL</span>
        <div class="code-panel">
          <div class="sql-block" v-html="sqlHtml"></div>
          <CopyToClipboardButton class="copy-btn" :content="context.statement.sql" title="Copy SQL" />
        </div>
      </div>

      <div v-if="context.collection.warnings.length > 0" class="warnings">
        <span class="label">Warnings</span>
        <ul>
          <li v-for="(w, i) in context.collection.warnings" :key="i">{{ w }}</li>
        </ul>
      </div>

      <div v-if="context.collection.unavailableSections.length > 0" class="unavailable">
        <span class="label">Unavailable sections</span>
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>Table</th>
              <th>Reason</th>
              <th>Required permissions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in context.collection.unavailableSections" :key="i">
              <td>{{ s.section }}</td>
              <td>{{ [s.schemaName, s.tableName].filter(Boolean).join(".") }}</td>
              <td>{{ s.reason }}</td>
              <td>{{ s.requiredPermissions?.join(", ") ?? "" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="jsonToolbar">
      <span class="label">Full context (JSON, no masking applied)</span>
    </div>
    <div class="code-panel json-panel">
      <div class="json-block" v-html="jsonHtml"></div>
      <CopyToClipboardButton class="copy-btn" :content="contextJson" title="Copy JSON" />
    </div>

    <div class="footer">
      <VsCodeButton appearance="secondary" @click="close">Close</VsCodeButton>
    </div>
  </section>
</template>

<style scoped>
.PerformanceTuningPreviewPanel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 8px 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.header {
  flex: 0 0 auto;
}

.row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 4px;
}

.row.sql {
  align-items: flex-start;
}

.label {
  font-weight: 600;
  min-width: 110px;
  flex: 0 0 auto;
}

/* Wraps a code block + its floating copy button. `position: relative` makes
   it the positioning root for `.copy-btn` - same pattern RDH.vue already
   uses for its per-cell copy button (`td.vcell { position: relative }` +
   `.cell-actions { position: absolute }`), rather than putting the button
   as a flex sibling of the code block: a flex sibling only stays visible if
   the code block correctly shrinks to the row's available width, and an
   unbroken long SQL/JSON line can blow that sizing up (the block ends up
   sized to its content instead of the container, pushing the button
   off-screen). Taking the button out of flow avoids depending on that.
   `min-width: 0`/`min-height: 0` on the flex item itself is still needed so
   it can actually shrink within the row/column instead of growing to fit
   its (potentially very wide/tall) content. */
.code-panel {
  position: relative;
}

.row.sql .code-panel {
  flex: 1 1 auto;
  min-width: 0;
}

.sql-block {
  max-height: 160px;
  overflow: auto;
  border-radius: 3px;
}

/* createCodeHtmlString() (Prism, extension-side) renders
   <pre class="code-highlight"><code>...</code></pre> - v-html content
   bypasses Vue's `scoped` attribute, so these rules target it via
   :deep(). Colors/background/padding already come from the global
   .code-highlight rules in assets/scss/main.scss; only wrapping/sizing
   is overridden here. The extra right padding keeps code text from
   running under the floating copy button. */
.sql-block :deep(pre.code-highlight),
.json-block :deep(pre.code-highlight) {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  padding-right: 32px;
}

.copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
}

.badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.9em;
}

.badge.complete {
  background: var(--vscode-testing-iconPassed, #2e7d32);
  color: white;
}

.badge.partial {
  background: var(--vscode-editorWarning-foreground, #ff9800);
  color: black;
}

.exceeded {
  color: var(--vscode-errorForeground);
  font-weight: 600;
}

.warnings ul {
  margin: 2px 0 8px 0;
}

.unavailable table {
  border-collapse: collapse;
  width: 100%;
  margin: 4px 0 8px 0;
  font-size: 0.9em;
}

.unavailable th,
.unavailable td {
  border: 1px solid var(--vscode-editorWidget-border, #444);
  padding: 2px 6px;
  text-align: left;
}

.jsonToolbar {
  margin-top: 4px;
  flex: 0 0 auto;
}

.json-panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  border-radius: 3px;
}

.json-block {
  height: 100%;
  overflow: auto;
}

.json-block :deep(pre.code-highlight) {
  font-size: 0.85em;
}

.footer {
  flex: 0 0 auto;
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
</style>
