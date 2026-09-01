<script setup lang="ts">
import { estimatesToRows } from "@/utilities/bindParameterRows";
import {
  vscode,
  type BindParameterRow,
  type PerformanceTuningBindParametersPanelEventData,
} from "@/utilities/vscode";
import { ref } from "vue";
import BindParametersEditor from "./BindParametersEditor.vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";

// Shared bind-value panel for previews opened from Query Statistics or Query History.

const sqlHtml = ref("");
const dbType = ref("");
const bindParameterRows = ref<BindParameterRow[]>([]);
const submitting = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const errorTechnicalMessage = ref<string | undefined>(undefined);
const cancelledNote = ref(false);
const hasPresetValues = ref(false);

const initialize = (v: PerformanceTuningBindParametersPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  sqlHtml.value = v.sqlHtml;
  dbType.value = v.dbType;
  bindParameterRows.value = estimatesToRows(v.estimatedBindParameters, v.presetBindValues);
  hasPresetValues.value = v.presetBindValues !== undefined && v.presetBindValues.length > 0;
  submitting.value = false;
  errorMessage.value = undefined;
  errorTechnicalMessage.value = undefined;
  cancelledNote.value = false;
};

const recieveMessage = (data: PerformanceTuningBindParametersPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      initialize(value.initialize);
      break;
    case "collection-result":
      submitting.value = false;
      if (value.collectionResult?.status === "failed") {
        errorMessage.value = value.collectionResult.message;
        errorTechnicalMessage.value = value.collectionResult.technicalMessage;
        cancelledNote.value = false;
      } else if (value.collectionResult?.status === "cancelled") {
        cancelledNote.value = true;
        errorMessage.value = undefined;
        errorTechnicalMessage.value = undefined;
      }
      break;
  }
};

const close = (): void => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const preview = (): void => {
  if (submitting.value) {
    return;
  }
  submitting.value = true;
  errorMessage.value = undefined;
  errorTechnicalMessage.value = undefined;
  cancelledNote.value = false;
  vscode.postCommand({
    command: "submitPerformanceTuningBindParameters",
    params: {
      values: bindParameterRows.value.map((row) => row.value),
      markers: bindParameterRows.value.map((row) => row.marker),
    },
  });
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="PerformanceTuningBindParametersPanel">
    <PanelActionToolbar @cancel="close" cancel-label="" cancel-title="Close">
      <template #left>
        <VsCodeButton :disabled="submitting" title="Collect the execution plan using these bind values"
          @click="preview">
          <fa icon="magnifying-glass-chart" />{{ submitting ? "Collecting…" : "Preview tuning data" }}
        </VsCodeButton>
      </template>
    </PanelActionToolbar>

    <div class="header">
      <div class="row sql">
        <span class="label">SQL</span>
        <div class="sql-block" v-html="sqlHtml"></div>
      </div>
      <p class="hint">
        This statement has placeholders.
        <template v-if="hasPresetValues">
          Values below are pre-filled from the last execution - review or edit them, then click "Preview tuning
          data" to collect its execution plan.
        </template>
        <template v-else>
          Enter representative values below, then click "Preview tuning data" to collect its execution plan.
        </template>
      </p>
    </div>

    <div class="content">
      <BindParametersEditor v-model="bindParameterRows" :db-type="dbType" :disabled="submitting" />
      <div v-if="cancelledNote" class="status-banner">Collection cancelled.</div>
      <div v-else-if="errorMessage" class="status-banner error">
        {{ errorMessage }}
        <details v-if="errorTechnicalMessage">
          <summary>Technical details</summary>
          <p>{{ errorTechnicalMessage }}</p>
        </details>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.PerformanceTuningBindParametersPanel {
  width: 100%;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 8px 12px;
  box-sizing: border-box;
  overflow: hidden;

  .header {
    flex: 0 0 auto;

    .row {
      display: flex;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 4px;

      &.sql {
        align-items: flex-start;

        .sql-block {
          flex: 1 1 auto;
          min-width: 0;
        }
      }
    }

    .label {
      font-weight: 600;
      min-width: 60px;
      flex: 0 0 auto;
    }

    .sql-block {
      max-height: 160px;
      overflow: auto;
      border-radius: 3px;

      // createCodeHtmlString() (Prism, extension-side) renders
      // <pre class="code-highlight"><code>...</code></pre> - v-html content
      // bypasses Vue's `scoped` attribute, so this targets it via :deep(),
      // same as PerformanceTuningPreviewPanel.vue's own .sql-block.
      :deep(pre.code-highlight) {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
    }

    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin: 4px 0 0 0;
    }
  }

  .content {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    margin-top: 4px;
  }

  .status-banner {
    padding: 4px;
    margin-top: 8px;
    color: var(--vscode-descriptionForeground);

    &.error {
      color: var(--vscode-errorForeground);
    }
  }
}
</style>
