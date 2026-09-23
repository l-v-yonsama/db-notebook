<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  LogParseSettingPanelEventData,
  LogParseWorkflowState,
  SaveLogOptionParams,
} from "@/utilities/vscode";
import { formatLogParseDiagnostics, getLogParseNextAction, vscode } from "@/utilities/vscode";
import { computed, ref } from "vue";
import LogParsePreview from "./LogParsePreview.vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import VsCodeDropdown from "../base/VsCodeDropdown.vue";
import type {
  InitializePayload,
  ResetConfigFileAndItemsPayload,
  ResetConfigPayload,
} from "./LogParseSettingPanel.types";

const sampleLinesToParse = ref("-1");
const configFile = ref("");
let lastConfigFile = "";
const configFileItems = ref<DropdownItem[]>([]);
const lineItems = ref<DropdownItem[]>([]);
const formatterSqlLanguage = ref<
  Exclude<InitializePayload["formatterSqlLanguage"], undefined> | ""
>("");
const formatterSqlLanguageItems = ref<DropdownItem[]>([]);
const initializing = ref(true);
const totalLogLines = ref(0);
const pendingOperationId = ref<number>();
const pendingAction = ref<SaveLogOptionParams["action"]>();
let nextOperationId = 0;
const operationError = ref("");
const processing = computed(() => pendingOperationId.value !== undefined);
const workflow = ref<LogParseWorkflowState>({
  revision: -1,
  configuration: {
    hasConfig: false,
    hasSplitFields: false,
    canSplit: false,
    canParse: false,
    splitError: "",
    parseError: "",
  },
});
const configSummary = ref<InitializePayload["configSummary"]>({
  logEventSplitPattern: "",
  logEventFieldsPattern: "",
  classificationSummary: "",
  extractionSummary: "",
});
const logSplitDetectionMessage = ref("");
const splitPresetItems = ref<DropdownItem[]>([]);
const splitPresetName = ref("");
const sqlParseDetectionMessage = ref("");
const sqlParsePresetItems = ref<DropdownItem[]>([]);
const sqlParsePresetName = ref("");

const setup = computed(() => workflow.value.setup);
const displayedResult = computed(() => workflow.value.result);
const logSample = computed(() => setup.value?.sql ?? setup.value?.split);
const logPreview = computed(() => logSample.value?.classifiedPreview ?? logSample.value?.preview);
const sqlSample = computed(() => setup.value?.sql);
const currentLogEventSplitPattern = computed(() => configSummary.value.logEventSplitPattern);
const currentLogFieldsPattern = computed(() => configSummary.value.logEventFieldsPattern);
const currentEventClassification = computed(() => configSummary.value.classificationSummary);
const currentSqlExtractionFlow = computed(() => configSummary.value.extractionSummary);
const canSplitLog = computed(() => workflow.value.configuration.canSplit);
const canParseLog = computed(() => workflow.value.configuration.canParse);
const isConfigFileSelected = computed(() => workflow.value.configuration.hasConfig);
const nextAction = computed(() => getLogParseNextAction(workflow.value));
const primaryAction = computed(() => {
  if (processing.value) {
    return "";
  }
  if (splitPresetName.value) {
    return "apply-split";
  }
  if (sqlParsePresetName.value) {
    return "apply-sql";
  }
  return nextAction.value;
});
const errorMessage = computed(
  () =>
    operationError.value ||
    workflow.value.previewError ||
    displayedResult.value?.error ||
    (!canSplitLog.value
      ? workflow.value.configuration.splitError
      : workflow.value.configuration.parseError)
);
const diagnostics = computed(() =>
  displayedResult.value?.status === "success"
    ? displayedResult.value.diagnostics
    : setup.value?.split?.result.diagnostics
);
const diagnosticMessage = computed(() =>
  displayedResult.value?.status === "success" || diagnostics.value
    ? formatLogParseDiagnostics(diagnostics.value)
    : ""
);
const resultLocation = computed(() => {
  const result = displayedResult.value;
  if (result?.status !== "success" || result.sample) {
    return "";
  }
  const table = result.stage === "split" ? "SPLIT-LOG-EVENT" : "SQL-EXECUTION";
  return `"Log Parse Result" view → "${result.logName}" tab → table selector at the top right: "${table}".`;
});
const previewMessage = computed(() => {
  switch (workflow.value.previewStatus) {
    case "waiting":
      return "Preview update pending · Previous results may be shown.";
    case "running":
      return "Updating preview… Previous results may be shown.";
    case "failed":
      return "Preview failed. Any table below shows the previous result.";
    case "stale":
      return "Previous result · Preview has not been updated for these settings.";
    default:
      return "";
  }
});
const previewBusy = computed(() =>
  ["waiting", "running"].includes(workflow.value.previewStatus ?? "")
);
const guidance = computed(() => {
  if (processing.value) {
    return "Working…";
  }
  if (errorMessage.value) {
    return errorMessage.value;
  }
  if (previewBusy.value) {
    return "Preview updates automatically when the settings change.";
  }
  if (!isConfigFileSelected.value) {
    return "Select a config file, or create one for a new log format.";
  }
  if (resultLocation.value) {
    return "Parsing complete. Review the SQL results in the Log Parse Result view.";
  }
  if (!canSplitLog.value) {
    return "Choose a log split preset in b), or edit the config.";
  }
  if (!canParseLog.value) {
    return "Review b). Complete the classify and extractor settings, or apply a SQL output preset.";
  }
  if (sqlSample.value?.result.sqlCount === 0) {
    return "No SQL was found in this sample. Adjust the settings or select Parse all log to check the entire log.";
  }
  return "Preview updates automatically. Review b) and c), then select Parse all log.";
});

const computedPresetInfo = computed(() => {
  const split = splitPresetItems.value.find((item) => item.value === splitPresetName.value)?.meta;
  const sql = sqlParsePresetItems.value.find(
    (item) => item.value === sqlParsePresetName.value
  )?.meta;
  return {
    logExample: split?.logExample ?? "",
    logFieldsPattern: split?.logFieldsPattern ?? "",
    logEventSplitPattern: split?.logEventSplitPattern ?? "",
    classificationSummary: sql?.classificationSummary ?? "",
    extractionSummary: sql?.extractionSummary ?? "",
  };
});

const resetConfig = (payload: ResetConfigPayload) => {
  if (payload.workflow.revision < workflow.value.revision) {
    return;
  }
  operationError.value = "";
  if (lastConfigFile !== payload.logParserConfigFile) {
    splitPresetName.value = "";
    sqlParsePresetName.value = "";
  }
  workflow.value = payload.workflow;
  sampleLinesToParse.value = String(
    payload.workflow.setup?.sampleLinesToParse ?? sampleLinesToParse.value
  );
  configSummary.value = payload.configSummary;
  configFile.value = payload.logParserConfigFile;
  lastConfigFile = payload.logParserConfigFile;
  logSplitDetectionMessage.value = payload.preset.logSplitDetectionMessage;
  sqlParseDetectionMessage.value = payload.preset.sqlParseDetectionMessage;
  splitPresetItems.value = [
    { label: "-- Select --", value: "" },
    ...payload.preset.logEventSplitPresets.map((item) => ({
      label: item.label,
      value: item.name,
      meta: item,
    })),
  ];
  sqlParsePresetItems.value = [
    { label: "-- Select --", value: "" },
    ...payload.preset.sqlParsePresets.map((item) => ({
      label: item.label,
      value: item.name,
      meta: item,
    })),
  ];
};

const initialize = (payload: InitializePayload) => {
  totalLogLines.value = payload.totalLogLines;
  const limits =
    payload.totalLogLines < 50
      ? [payload.totalLogLines]
      : [50, 100, 200, 500, 1000].filter((n) => n <= payload.totalLogLines);
  lineItems.value = [
    ...limits.filter((n) => n > 0).map((n) => ({ label: `First ${n} lines`, value: String(n) })),
    { label: "All", value: "-1" },
  ];
  sampleLinesToParse.value = String(payload.linesToParse);
  formatterSqlLanguageItems.value = [
    { label: "-- Select --", value: "" },
    ...payload.formatterSqlLanguageItems,
  ];
  formatterSqlLanguage.value = payload.formatterSqlLanguage ?? "";
  configFileItems.value = [{ label: "-- Select --", value: "" }, ...payload.logParserConfigItems];
  pendingOperationId.value = undefined;
  operationError.value = "";
  splitPresetName.value = "";
  sqlParsePresetName.value = "";
  resetConfig(payload);
  initializing.value = false;
};

const resetConfigFileAndItems = (payload: ResetConfigFileAndItemsPayload) => {
  configFileItems.value = [{ label: "-- Select --", value: "" }, ...payload.logParserConfigItems];
  configFile.value = payload.logParserConfigFile;
};

const postOk = (options: Omit<SaveLogOptionParams, "operationId" | "logParserConfigFile">) => {
  if (processing.value) {
    return;
  }
  operationError.value = "";
  pendingOperationId.value = ++nextOperationId;
  pendingAction.value = options.action;
  vscode.postCommand({
    command: "ok",
    params: {
      ...options,
      operationId: pendingOperationId.value,
      logParserConfigFile: configFile.value,
    },
  });
};
const cancel = () => vscode.postCommand({ command: "cancel", params: {} });
const resetSampleLines = () =>
  postOk({ action: "reset-sample-lines", linesToParse: Number(sampleLinesToParse.value) });
const resetSqlLanguage = () =>
  postOk({
    action: "reset-formatter-sql-language",
    sqlLanguage: formatterSqlLanguage.value || undefined,
  });
const applyLogEventSplitPreset = () =>
  postOk({ action: "apply-log-event-split-preset", presetName: splitPresetName.value });
const applySqlParsePreset = () =>
  postOk({ action: "apply-parser-sql-preset", presetName: sqlParsePresetName.value });
const openAsJSON = () => postOk({ action: "open-as-json" });

const recieveMessage = ({ command, value }: LogParseSettingPanelEventData) => {
  switch (command) {
    case "initialize":
      if (value.initialize) {
        initialize(value.initialize);
      }
      break;
    case "reset-config":
      if (value["reset-config"]) {
        resetConfig(value["reset-config"]);
      }
      break;
    case "reset-config-file-and-items":
      if (value["reset-config-file-and-items"]) {
        resetConfigFileAndItems(value["reset-config-file-and-items"]);
      }
      break;
    case "operation-completed": {
      const result = value["operation-completed"];
      if (!result || result.operationId !== pendingOperationId.value) {
        return;
      }
      operationError.value = result.error ?? "";
      if (!result.error) {
        if (pendingAction.value === "apply-log-event-split-preset") {
          splitPresetName.value = "";
        }
        if (pendingAction.value === "apply-parser-sql-preset") {
          sqlParsePresetName.value = "";
        }
      }
      pendingOperationId.value = undefined;
      pendingAction.value = undefined;
      break;
    }
  }
};
defineExpose({ recieveMessage });
</script>

<template>
  <section class="log-conditional-root" :aria-busy="processing">
    <div class="panel-header">
      <span class="panel-title">Log parse settings</span>
      <div class="panel-actions">
        <VsCodeButton
          v-if="!isConfigFileSelected"
          appearance="primary"
          :disabled="processing"
          @click="postOk({ action: 'create-new-config' })"
          ><fa icon="plus" />Create new config</VsCodeButton
        >
        <VsCodeButton
          v-if="isConfigFileSelected"
          class="panel-edit"
          title="Open the config JSON beside this panel to fine-tune rules or combine settings from other configs."
          :appearance="primaryAction === 'edit-config' ? 'primary' : 'secondary'"
          :disabled="processing"
          @click="openAsJSON"
          ><fa icon="pencil" />Edit JSON</VsCodeButton
        >

        <VsCodeButton
          v-if="workflow.configDirty"
          appearance="secondary"
          :disabled="processing"
          @click="postOk({ action: 'save-config' })"
          >Save config</VsCodeButton
        >
        <VsCodeButton
          v-if="canParseLog"
          appearance="primary"
          :disabled="processing"
          @click="
            postOk({
              action: 'parse',
              linesToParse: -1,
            })
          "
          >Parse all log</VsCodeButton
        >
        <VsCodeButton class="panel-close" appearance="icon" title="Close" @click="cancel">
          <fa icon="times" />
        </VsCodeButton>
      </div>
    </div>
    <div
      class="workflow-guidance"
      :class="{ 'has-error': errorMessage }"
      role="status"
      aria-live="polite"
    >
      <p>{{ guidance }}</p>
      <p v-if="resultLocation && !errorMessage && !processing">
        {{ resultLocation }}
      </p>
      <details v-if="diagnosticMessage && !errorMessage && !processing" class="diagnostic">
        <summary>
          {{
            diagnostics?.unmatchedEventCount
              ? `${diagnostics.unmatchedEventCount} log events did not match the field pattern.`
              : "Field extraction diagnostics are unavailable."
          }}
        </summary>
        <p>{{ diagnosticMessage }}</p>
      </details>
    </div>
    <div v-if="!initializing" class="scroll-wrapper">
      <section class="config-file-section">
        <div
          class="config-selector"
          :class="{ 'next-action-field': primaryAction === 'select-config' }"
        >
          <label for="logConfigFile">Config file</label>
          <span v-if="primaryAction === 'select-config'" class="next-label"
            >Next: Select a config file</span
          >
          <VsCodeDropdown
            id="logConfigFile"
            aria-label="Config file"
            :disabled="processing"
            v-model="configFile"
            :items="configFileItems"
            @change="postOk({ action: 'set-config-file' })"
          />
          <span v-if="configFile" class="config-path"
            >{{ configFile }} · {{ workflow.configDirty ? "Unsaved changes" : "Saved" }}</span
          >
          <div v-if="isConfigFileSelected" class="config-actions">
            <VsCodeButton
              appearance="secondary"
              :disabled="processing"
              @click="postOk({ action: 'copy-config' })"
              >Copy config and adjust</VsCodeButton
            >
            <span class="hint">
              For custom rules, use <strong>Edit JSON</strong> to open the config beside this panel.
              To keep the original, choose <strong>Copy config and adjust</strong> first.
            </span>
          </div>
        </div>
      </section>

      <template v-if="!initializing">
        <details open class="log-section">
          <summary>a) RAW LOG</summary>
          <div class="raw-sample-controls">
            <span>Total: {{ totalLogLines.toLocaleString() }} lines</span>
            <label for="logSampleLines">· Test sample:</label>
            <VsCodeDropdown
              id="logSampleLines"
              aria-label="Sample lines"
              :disabled="processing"
              v-model="sampleLinesToParse"
              :items="lineItems"
              @change="resetSampleLines"
            />
          </div>
          <LogParsePreview
            v-if="workflow.rawPreview"
            :rdh="workflow.rawPreview"
            :total="totalLogLines"
            :show-count="false"
          />
        </details>
        <details v-if="isConfigFileSelected" open class="log-section">
          <summary>b) SPLIT &amp; CLASSIFIED LOG</summary>
          <div
            class="preset-grid settings-block"
            role="group"
            aria-label="Split & classification settings"
          >
            <div
              class="preset-field"
              :class="{ 'next-action-field': primaryAction === 'select-split' }"
            >
              <div class="preset-heading">
                <label for="logSplitPreset">Log split preset</label>
                <span v-if="logSplitDetectionMessage" class="hint">{{
                  logSplitDetectionMessage
                }}</span>
              </div>
              <div class="preset-controls">
                <VsCodeDropdown
                  id="logSplitPreset"
                  aria-label="Log split preset"
                  :disabled="processing"
                  v-model="splitPresetName"
                  :items="splitPresetItems"
                />
                <VsCodeButton
                  :disabled="processing || !splitPresetName"
                  :appearance="primaryAction === 'apply-split' ? 'primary' : 'secondary'"
                  @click="applyLogEventSplitPreset"
                  >Apply</VsCodeButton
                >
              </div>
              <p v-if="workflow.appliedSplitPreset" class="hint">
                Applied: {{ workflow.appliedSplitPreset }}
              </p>
              <details v-if="splitPresetName" class="preset-details">
                <summary>Selected preset details</summary>
                <div class="detail-content">
                  <strong>Example log</strong>
                  <pre>{{ computedPresetInfo.logExample }}</pre>
                  <strong>Log event split pattern</strong>
                  <pre>{{ computedPresetInfo.logEventSplitPattern }}</pre>
                  <strong>Log event fields pattern</strong>
                  <pre>{{ computedPresetInfo.logFieldsPattern }}</pre>
                </div>
              </details>
              <div class="settings-summary">
                <strong>Log event split pattern</strong>
                <pre>{{ currentLogEventSplitPattern || "Not configured" }}</pre>
                <strong>Log event fields pattern</strong>
                <pre>{{ currentLogFieldsPattern || "Not configured" }}</pre>
              </div>
            </div>
            <div
              class="preset-field"
              :class="{ 'next-action-field': primaryAction === 'select-sql' }"
            >
              <div class="preset-heading">
                <label for="logSqlPreset">SQL output preset (classify &amp; extract)</label>
                <span v-if="sqlParseDetectionMessage" class="hint">{{
                  sqlParseDetectionMessage
                }}</span>
              </div>
              <div class="preset-controls">
                <VsCodeDropdown
                  id="logSqlPreset"
                  aria-label="SQL output preset"
                  :disabled="processing"
                  v-model="sqlParsePresetName"
                  :items="sqlParsePresetItems"
                />
                <VsCodeButton
                  :disabled="processing || !canSplitLog || !sqlParsePresetName"
                  :appearance="primaryAction === 'apply-sql' ? 'primary' : 'secondary'"
                  @click="applySqlParsePreset"
                  >Apply</VsCodeButton
                >
              </div>
              <p v-if="workflow.appliedSqlPreset" class="hint">
                Applied: {{ workflow.appliedSqlPreset }}
              </p>
              <details v-if="sqlParsePresetName" class="preset-details">
                <summary>Selected preset details</summary>
                <div class="detail-content">
                  <strong>Event classification</strong>
                  <pre>{{ computedPresetInfo.classificationSummary }}</pre>
                  <strong>SQL extraction flow</strong>
                  <pre>{{ computedPresetInfo.extractionSummary }}</pre>
                </div>
              </details>
              <div class="settings-summary">
                <strong>Event classification</strong>
                <pre>{{ currentEventClassification || "Not configured" }}</pre>
              </div>
            </div>
          </div>
          <p v-if="previewMessage" class="hint" role="status" :aria-busy="previewBusy">
            <span v-if="previewBusy" class="preview-spinner" aria-hidden="true" />{{
              previewMessage
            }}
          </p>
          <LogParsePreview
            v-if="logPreview && logSample"
            :rdh="logPreview"
            :total="logSample.result.eventCount"
            :label="logSample.classifiedPreview ? 'Classified log' : 'Split log'"
          />
          <p v-else class="hint">
            {{
              canSplitLog
                ? "Log preview will appear automatically."
                : "Configure split rules to preview log events automatically."
            }}
          </p>
        </details>
        <details v-if="canParseLog" open class="log-section">
          <summary>c) EXTRACT &amp; FORMAT SQL</summary>
          <div class="options-grid settings-block">
            <div class="preset-field">
              <div class="field">
                <label for="logSqlLanguage">SQL formatter language (optional)</label>
                <VsCodeDropdown
                  id="logSqlLanguage"
                  aria-label="SQL formatter language"
                  :disabled="processing"
                  v-model="formatterSqlLanguage"
                  :items="formatterSqlLanguageItems"
                  @change="resetSqlLanguage"
                />
              </div>
            </div>
            <div class="preset-field">
              <strong>SQL extraction settings</strong>
              <pre>{{ currentSqlExtractionFlow || "Not configured" }}</pre>
            </div>
          </div>
          <p v-if="previewMessage" class="hint" role="status" :aria-busy="previewBusy">
            <span v-if="previewBusy" class="preview-spinner" aria-hidden="true" />{{
              previewMessage
            }}
          </p>
          <LogParsePreview
            v-if="sqlSample?.preview"
            :rdh="sqlSample.preview"
            :total="sqlSample.result.sqlCount"
          />
          <p v-else class="hint">SQL preview will appear automatically.</p>
        </details>
      </template>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.log-section {
  margin: 10px 0;
  padding: 8px;
  border: 1px solid var(--vscode-panel-border);
  min-width: 0;
}
.log-section > summary {
  font-weight: 600;
  margin: -8px;
  padding: 8px;
  background-color: var(
    --vscode-sideBarSectionHeader-background,
    var(--vscode-toolbar-hoverBackground)
  );
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
}
.log-section[open] > summary {
  margin-bottom: 8px;
}
.preview-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  border: 2px solid var(--vscode-panel-border);
  border-top-color: var(--vscode-progressBar-background);
  border-radius: 50%;
  animation: preview-spin 1s linear infinite;
}
@keyframes preview-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .preview-spinner {
    animation: none;
  }
}
.raw-sample-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.raw-sample-controls :deep(vscode-dropdown) {
  width: 180px;
  max-width: 100%;
}
.log-conditional-root {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
}
.panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  flex-shrink: 0;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  max-width: 100%;
}
.panel-edit {
  flex-shrink: 0;
}
.panel-close {
  flex-shrink: 0;
}
.config-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.panel-title {
  font-weight: 600;
  align-self: center;
}
.workflow-guidance {
  padding: 4px 10px;
  border-left: 3px solid var(--vscode-focusBorder);
  overflow-wrap: anywhere;
  flex-shrink: 0;
  p {
    margin: 3px 0;
  }
  &.has-error {
    border-color: var(--vscode-errorForeground);
  }
  .diagnostic {
    color: var(--vscode-editorWarning-foreground);
  }
}
:deep(.toolbar) {
  flex-wrap: wrap;
  height: auto;
  gap: 6px;
  flex-shrink: 0;
}
:deep(.tool-right) {
  flex-wrap: wrap;
  gap: 6px;
}
:deep(vscode-button[appearance="primary"]:hover) {
  background-color: var(--vscode-button-hoverBackground);
}
.scroll-wrapper {
  min-height: 0;
  overflow: auto;
  flex: 1;
}
.config-selector,
.preset-field {
  border: 2px solid transparent;
  padding: 8px;
  min-width: 0;
}
.config-selector {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}
.next-action-field {
  border-color: var(--vscode-focusBorder);
  border-radius: 3px;
}
.next-label {
  color: var(--vscode-textLink-foreground);
}
.config-file-section {
  overflow-wrap: anywhere;
}
.config-path {
  opacity: 0.75;
  overflow-wrap: anywhere;
  user-select: text;
}
.preset-grid,
.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
  gap: 8px;
}
.settings-block {
  border: 1px solid var(--vscode-panel-border);
  margin: 8px 0;
  align-items: start;
}
.preset-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.preset-heading .hint {
  margin: 0 0 0 auto;
  text-align: right;
}
.settings-summary {
  margin-top: 12px;
}
.settings-block pre:last-child {
  margin-bottom: 0;
}
.preset-controls {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.preset-controls :deep(vscode-dropdown) {
  flex: 1;
  min-width: 0;
}
.field {
  display: grid;
  gap: 6px;
}
.config-selector :deep(vscode-dropdown),
.field :deep(vscode-dropdown) {
  width: 100%;
  min-width: 0;
}
.hint {
  opacity: 0.8;
  margin: 6px 0;
}
.parse-options,
.config-summary {
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--vscode-panel-border);
}
.config-summary p {
  margin: 3px 0 6px;
}
summary {
  cursor: pointer;
  padding: 4px 0;
}
summary:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}
.detail-content {
  max-height: min(220px, 35vh);
  overflow: auto;
  padding: 8px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  user-select: text;
  margin: 6px 0 14px;
}
</style>
