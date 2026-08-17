<script setup lang="ts">
import type { PerformanceTuningDiagnosticGroupViewModel, PerformanceTuningPreviewPanelEventData } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { computed, ref } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import DiagnosticGroupCard from "./base/DiagnosticGroupCard.vue";
import VsCodeButton from "./base/VsCodeButton.vue";

const context = ref<PerformanceTuningContext | undefined>(undefined);
const diagnosticGroups = ref<PerformanceTuningDiagnosticGroupViewModel[]>([]);
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

// buildPerformanceTuningDiagnosticGroups() (extension-side) already sorts
// information before warnings and never mixes severities within one group -
// this just splits that single ordered list into the two display sections
// §6.1 puts in different places. Neither list is re-sorted or re-derived
// here (§7: grouping/copy stays entirely in that one pure function).
const infoGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "info"));
const issueGroups = computed(() => diagnosticGroups.value.filter((g) => g.severity === "warning"));

// §6.4: "partial なのに画面上に理由が1件も表示されない状態を禁止する" - status
// is derived driver-side from unavailableSections/diagnostics together
// (db-drivers §2.2), so whenever it's 'partial', issueGroups is guaranteed
// non-empty by construction (every unavailableSections entry and every
// affectsCompleteness diagnostic becomes a warning-severity group). Nothing
// extra to compute here; this comment just records the invariant this
// template relies on.

const initialize = (v: PerformanceTuningPreviewPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  context.value = v.context;
  diagnosticGroups.value = v.diagnosticGroups;
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
    <!-- 1. Database / Status / Payload size (§6.1) -->
    <div class="header">
      <div class="row">
        <span class="label">Database</span>
        <span>{{ context.database.vendor }}{{ context.database.version ? ` ${context.database.version}` : "" }} ・
          {{ context.database.databaseName }}<span v-if="context.database.schemaName">.{{ context.database.schemaName }}</span></span>
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="badge" :class="context.collection.status">{{ context.collection.status }}</span>
        <!-- complete badge stays green even with informational notes present
             (§6.4) - this is a supplementary count, not a new status value. -->
        <span v-if="context.collection.status === 'complete' && infoGroups.length > 0" class="notes-hint">
          {{ infoGroups.length }} {{ infoGroups.length === 1 ? "note" : "notes" }}
        </span>
      </div>
      <div class="row">
        <span class="label">Payload size</span>
        <span :class="{ exceeded: payloadExceeded }">
          {{ payloadBytes.toLocaleString() }} / {{ maxPayloadBytes.toLocaleString() }} bytes
          <span v-if="payloadExceeded">(exceeds limit)</span>
        </span>
      </div>

      <!-- 2. SQL (§6.1) -->
      <div class="row sql">
        <span class="label">SQL</span>
        <div class="code-panel">
          <div class="sql-block" v-html="sqlHtml"></div>
          <CopyToClipboardButton class="copy-btn" :content="context.statement.sql" title="Copy SQL" />
        </div>
      </div>
    </div>

    <div class="scrollArea">
      <!-- 3. Collection issues: warning-severity diagnostics + unavailable
           sections, already merged into one list extension-side (§6.1/§6.3). -->
      <div v-if="issueGroups.length > 0" class="section">
        <h3 class="section-title">Collection issues</h3>
        <DiagnosticGroupCard v-for="g in issueGroups" :key="g.key" :group="g" />
      </div>

      <!-- 4. Information / plan notes: informational, never warning-colored
           (§6.1/§6.2). -->
      <div v-if="infoGroups.length > 0" class="section">
        <h3 class="section-title">Information</h3>
        <DiagnosticGroupCard v-for="g in infoGroups" :key="g.key" :group="g" />
      </div>

      <!-- 5. Full context JSON, as "Advanced details" - collapsed by default
           (§6.5). -->
      <details class="section advanced-details">
        <summary class="section-title">Advanced details: Full context JSON</summary>
        <p class="advanced-note">
          This preview includes SQL, table definitions, and predicates exactly as collected. Review the content
          before sending it to an AI service.
        </p>
        <div class="code-panel json-panel">
          <div class="json-block" v-html="jsonHtml"></div>
          <CopyToClipboardButton class="copy-btn" :content="contextJson" title="Copy JSON" />
        </div>
      </details>
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

.notes-hint {
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
}

.exceeded {
  color: var(--vscode-errorForeground);
  font-weight: 600;
}

/* The scrollable body between the fixed header and footer - Collection
   issues / Information / Advanced details can all be long, so only this
   area scrolls, keeping Database/Status/SQL always visible. */
.scrollArea {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  margin-top: 4px;
}

.section {
  margin-bottom: 12px;
}

.section-title {
  font-size: 1em;
  margin: 0 0 4px 0;
}

.advanced-details > .section-title {
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
}

.advanced-note {
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
  margin: 4px 0 8px 0;
}

.json-panel {
  min-height: 200px;
  max-height: 60vh;
  overflow: hidden;
  border-radius: 3px;
}

.json-block {
  height: 100%;
  max-height: 60vh;
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
