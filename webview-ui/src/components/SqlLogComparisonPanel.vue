<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import { vscode } from "../utilities/vscode";

type FileField = "beforeFile" | "afterFile" | "beforeParserConfigFile" | "afterParserConfigFile" | "outputDirectory";
type Choice = { label: string; value: string };
type Preview = { status: string; beforeSql: string; afterSql: string; diffText?: string };
type Update = {
  value?: {
    type: string;
    paths?: Partial<Record<FileField, string>>;
    uris?: Partial<Record<FileField, string>>;
    choices?: Choice[];
    message?: string;
    kind?: "info" | "success" | "error";
    ready?: boolean;
    running?: boolean;
    revision?: number;
    preview?: Preview;
    equivalence?: Record<string, boolean>;
  };
};

const paths = ref<Partial<Record<FileField, string>>>({});
const beforeParser = ref("");
const afterParser = ref("");
const parserChoices = ref<Choice[]>([]);
const dialect = ref("mysql");
const ignoreIdentifierCase = ref(false);
const ignoreSingleTableAlias = ref(false);
const ignoreOrdinaryComments = ref(true);
const ignoreOptimizerHints = ref(false);
const normalizeDateFunctions = ref(true);
const ignoreDateTimeLiteralValues = ref(false);
const removeRedundantWhereParentheses = ref(true);
const running = ref(false);
const reportReady = ref(false);
const statusMessage = ref("Select input files.");
const statusKind = ref<"info" | "success" | "error">("info");
const preview = ref<Preview>();
let previewRevision = 0;

const configItems = computed(() => [{ label: "Select config", value: "" }, ...parserChoices.value]);
const dialectItems = [
  { label: "MySQL", value: "mysql" },
  { label: "PostgreSQL", value: "postgresql" },
  { label: "Transact-SQL", value: "transactsql" },
  { label: "SQLite", value: "sqlite" },
  { label: "Oracle (PL/SQL)", value: "plsql" },
];
const dialectLabel = computed(() => dialectItems.find((item) => item.value === dialect.value)?.label ?? dialect.value);
const supportsDateFunctionEquivalence = computed(() => dialect.value !== "sqlite" && dialect.value !== "plsql");
const canCompare = computed(() => !running.value && !!(
  paths.value.beforeFile && paths.value.afterFile && beforeParser.value && afterParser.value && paths.value.outputDirectory
));
const previewMatched = computed(() => preview.value?.status === "FORMATTED_MATCH" || preview.value?.status === "EQUIVALENT_MATCH");
const previewLines = computed(() => ({
  before: preview.value?.beforeSql.split("\n") ?? [],
  after: preview.value?.afterSql.split("\n") ?? [],
}));
const highlightedLines = computed(() => {
  const before = new Set<string>();
  const after = new Set<string>();
  for (const line of preview.value?.diffText?.split("\n") ?? []) {
    if (line.startsWith("-")) { before.add(line.slice(1)); }
    if (line.startsWith("+")) { after.add(line.slice(1)); }
  }
  return { before, after };
});

function fileName(filePath?: string): string {
  if (!filePath) { return "No file selected"; }
  return filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
}

function parentDirectory(filePath?: string): string {
  if (!filePath) { return ""; }
  return filePath.slice(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
}

function post(command: string, details: Record<string, unknown> = {}) {
  vscode.postMessage({ command, ...details });
}

function pick(field: FileField) { post("pick", { field }); }
function selectParser(field: "beforeParserConfigFile" | "afterParserConfigFile", uri: string) {
  post("selectParserConfig", { field, uri });
}
function currentOptions() {
  return {
    dialect: dialect.value,
    equivalence: {
      ignoreIdentifierCase: ignoreIdentifierCase.value,
      ignoreSingleTableAlias: ignoreSingleTableAlias.value,
      ignoreOrdinaryComments: ignoreOrdinaryComments.value,
      ignoreOptimizerHints: ignoreOptimizerHints.value,
      normalizeDateFunctions: supportsDateFunctionEquivalence.value && normalizeDateFunctions.value,
      ignoreDateTimeLiteralValues: ignoreDateTimeLiteralValues.value,
      removeRedundantWhereParentheses: removeRedundantWhereParentheses.value,
    },
  };
}

function compare() { post("run", { options: currentOptions() }); }
function requestPreview() { post("preview", { options: currentOptions(), revision: ++previewRevision }); }
watch([dialect, ignoreIdentifierCase, ignoreSingleTableAlias, ignoreOrdinaryComments, ignoreOptimizerHints, normalizeDateFunctions, ignoreDateTimeLiteralValues, removeRedundantWhereParentheses], requestPreview);

function recieveMessage(data: Update) {
  const update = data.value;
  if (!update) { return; }
  if (update.type === "files") {
    paths.value = update.paths ?? {};
    beforeParser.value = update.uris?.beforeParserConfigFile ?? "";
    afterParser.value = update.uris?.afterParserConfigFile ?? "";
  } else if (update.type === "parserChoices") {
    parserChoices.value = update.choices ?? [];
  } else if (update.type === "equivalenceOptions") {
    const options = update.equivalence ?? {};
    if (typeof options.ignoreIdentifierCase === "boolean") { ignoreIdentifierCase.value = options.ignoreIdentifierCase; }
    if (typeof options.ignoreSingleTableAlias === "boolean") { ignoreSingleTableAlias.value = options.ignoreSingleTableAlias; }
    if (typeof options.ignoreOrdinaryComments === "boolean") { ignoreOrdinaryComments.value = options.ignoreOrdinaryComments; }
    if (typeof options.ignoreOptimizerHints === "boolean") { ignoreOptimizerHints.value = options.ignoreOptimizerHints; }
    if (typeof options.normalizeDateFunctions === "boolean") { normalizeDateFunctions.value = options.normalizeDateFunctions; }
    if (typeof options.ignoreDateTimeLiteralValues === "boolean") { ignoreDateTimeLiteralValues.value = options.ignoreDateTimeLiteralValues; }
    if (typeof options.removeRedundantWhereParentheses === "boolean") { removeRedundantWhereParentheses.value = options.removeRedundantWhereParentheses; }
  } else if (update.type === "status") {
    statusMessage.value = update.message ?? "";
    statusKind.value = update.kind ?? "info";
  } else if (update.type === "running") {
    running.value = !!update.running;
  } else if (update.type === "reportReady") {
    reportReady.value = !!update.ready;
  } else if (update.type === "preview" && update.revision === previewRevision) {
    preview.value = update.preview;
  }
}

defineExpose({ recieveMessage });
</script>

<template>
  <section class="sql-comparison-root" :aria-busy="running">
    <header class="panel-header">
      <span class="panel-title">SQL Log Comparison</span>
      <PanelActionToolbar @cancel="post('close')" cancel-label="" cancel-title="Close" :cancel-disabled="running">
        <template #left>
          <VsCodeButton appearance="secondary" title="Swap before and after" :disabled="running" @click="post('swap')">
            <fa icon="rotate" />Swap
          </VsCodeButton>
          <VsCodeButton title="Compare logs" :disabled="!canCompare" @click="compare">
            <fa icon="code-compare" />Compare
          </VsCodeButton>
        </template>
        <VsCodeButton appearance="secondary" title="Open Excel report" :disabled="!reportReady || running" @click="post('openReport')">
          <fa icon="file-excel" />Open Report
        </VsCodeButton>
      </PanelActionToolbar>
    </header>

    <div class="status-message" :class="statusKind" role="status" aria-live="polite">
      <fa :icon="statusKind === 'error' ? 'circle-exclamation' : statusKind === 'success' ? 'circle-check' : 'circle-info'" aria-hidden="true" />
      <span>{{ statusMessage }}</span>
    </div>

    <div class="content">
      <fieldset>
        <legend>Input</legend>
        <div class="columns">
          <fieldset class="side">
            <legend>Before</legend>
            <div class="field-row">
              <label>Log file:</label>
              <div class="field-value">
                <small v-if="paths.beforeFile" class="parent-path" :title="parentDirectory(paths.beforeFile)">{{ parentDirectory(paths.beforeFile) }}</small>
                <div class="path-row"><span class="file-name" :title="paths.beforeFile">{{ fileName(paths.beforeFile) }}</span>
                  <VsCodeButton appearance="secondary" title="Select before log" :disabled="running" @click="pick('beforeFile')">Select</VsCodeButton></div>
              </div>
            </div>
            <div class="field-row">
              <label for="beforeParser">Parser config:</label>
              <div class="config-row"><VsCodeDropdown id="beforeParser" v-model="beforeParser" :items="configItems" :disabled="running" @change="selectParser('beforeParserConfigFile', beforeParser)" />
                <VsCodeButton appearance="secondary" title="Select before parser config" :disabled="running" @click="pick('beforeParserConfigFile')">Select</VsCodeButton></div>
            </div>
          </fieldset>
          <fieldset class="side">
            <legend>After</legend>
            <div class="field-row">
              <label>Log file:</label>
              <div class="field-value">
                <small v-if="paths.afterFile" class="parent-path" :title="parentDirectory(paths.afterFile)">{{ parentDirectory(paths.afterFile) }}</small>
                <div class="path-row"><span class="file-name" :title="paths.afterFile">{{ fileName(paths.afterFile) }}</span>
                  <VsCodeButton appearance="secondary" title="Select after log" :disabled="running" @click="pick('afterFile')">Select</VsCodeButton></div>
              </div>
            </div>
            <div class="field-row">
              <label for="afterParser">Parser config:</label>
              <div class="config-row"><VsCodeDropdown id="afterParser" v-model="afterParser" :items="configItems" :disabled="running" @change="selectParser('afterParserConfigFile', afterParser)" />
                <VsCodeButton appearance="secondary" title="Select after parser config" :disabled="running" @click="pick('afterParserConfigFile')">Select</VsCodeButton></div>
            </div>
          </fieldset>
        </div>
      </fieldset>
      <fieldset>
        <legend>Output</legend>
        <div class="field-row">
          <label>Folder:</label>
          <div class="path-row"><span class="path" :title="paths.outputDirectory">{{ paths.outputDirectory || "No folder selected" }}</span>
            <VsCodeButton appearance="secondary" title="Select output folder" :disabled="running" @click="pick('outputDirectory')">Select</VsCodeButton></div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Comparison options</legend>
        <div class="option-row"><label for="dialect">Dialect:</label><VsCodeDropdown id="dialect" v-model="dialect" :items="dialectItems" :disabled="running" /><small>Interpret both logs using this SQL dialect.</small></div>
        <div class="rules-heading">Equivalent SQL rules</div>
        <small class="rules-note">Formatted SQL stays unchanged. Alias and date-time literal rules also affect WHERE match.</small>
        <div class="rule-grid">
          <div class="rule"><VsCodeCheckbox id="normalizeDateFunctions" v-model="normalizeDateFunctions" :disabled="running || !supportsDateFunctionEquivalence">Equivalent date functions</VsCodeCheckbox><small>{{ supportsDateFunctionEquivalence ? (dialect === "transactsql" ? "GETDATE() → CURRENT_TIMESTAMP" : "NOW() → CURRENT_TIMESTAMP") : "Not available for this dialect" }}</small></div>
          <div class="rule"><VsCodeCheckbox id="ignoreDateTimeLiteralValues" v-model="ignoreDateTimeLiteralValues" :disabled="running">Ignore date-time literal values</VsCodeCheckbox><small>Full timestamps → 2000-10-10 01:01:01.000</small></div>
          <div class="rule"><VsCodeCheckbox id="removeRedundantWhereParentheses" v-model="removeRedundantWhereParentheses" :disabled="running">Redundant WHERE parentheses</VsCodeCheckbox><small>WHERE (id = 1) → WHERE id = 1</small></div>
          <div class="rule"><VsCodeCheckbox id="ignoreIdentifierCase" v-model="ignoreIdentifierCase" :disabled="running">Ignore case in unquoted identifiers</VsCodeCheckbox><small>Created_At → created_at</small></div>
          <div class="rule"><VsCodeCheckbox id="ignoreSingleTableAlias" v-model="ignoreSingleTableAlias" :disabled="running">Ignore single-table aliases</VsCodeCheckbox><small>Unquoted: FROM orders t / t.id → FROM orders / id</small></div>
          <div class="rule"><VsCodeCheckbox id="ignoreOrdinaryComments" v-model="ignoreOrdinaryComments" :disabled="running">Ignore ordinary comments</VsCodeCheckbox><small>/* note */ → removed</small></div>
          <div class="rule"><VsCodeCheckbox id="ignoreOptimizerHints" v-model="ignoreOptimizerHints" :disabled="running">Ignore optimizer hint comments</VsCodeCheckbox><small>/*+ ... */ → removed</small></div>
        </div>
        <div class="preview">
          <div class="preview-heading"><span>Equivalent SQL example <small>({{ dialectLabel }})</small></span><span class="preview-status" :class="preview ? (previewMatched ? 'matched' : 'different') : ''">{{ preview ? (previewMatched ? 'Match' : 'Different') : 'Preparing…' }}</span></div>
          <div class="preview-columns">
            <div class="preview-side"><div class="preview-label">Before</div><pre><code><span v-for="(line, index) in previewLines.before" :key="index" class="sql-line" :class="{ removed: highlightedLines.before.has(line) }">{{ line }}</span></code></pre></div>
            <div class="preview-side"><div class="preview-label">After</div><pre><code><span v-for="(line, index) in previewLines.after" :key="index" class="sql-line" :class="{ added: highlightedLines.after.has(line) }">{{ line }}</span></code></pre></div>
          </div>
        </div>
      </fieldset>
    </div>
  </section>
</template>

<style scoped>
.sql-comparison-root { flex: 1; min-height: 0; width: 100%; box-sizing: border-box; padding: 10px 16px; overflow-y: auto; }
.panel-header { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
.panel-title { font-size: 16px; font-weight: 600; white-space: nowrap; }
.panel-header :deep(.toolbar) { width: 100%; margin-bottom: 0; }
.status-message { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; padding: 6px 10px; border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground); border-radius: 2px; background: var(--vscode-editorWidget-background); color: var(--vscode-foreground); overflow-wrap: anywhere; }
.status-message :deep(svg) { flex: none; margin-top: 2px; color: var(--vscode-notificationsInfoIcon-foreground); }
.status-message.success { border-left-color: var(--vscode-testing-iconPassed); }
.status-message.success :deep(svg) { color: var(--vscode-testing-iconPassed); }
.status-message.error { border-left-color: var(--vscode-errorForeground); }
.status-message.error :deep(svg) { color: var(--vscode-errorForeground); }
.content { width: 100%; box-sizing: border-box; }
fieldset { box-sizing: border-box; border: 1px solid var(--vscode-panel-border); margin: 0 0 14px; padding: 12px 16px 16px; min-width: 0; }
legend { padding: 0 7px; font-weight: 600; }
.columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.side { margin-bottom: 0; }
.field-row { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: 8px; margin: 10px 0; min-width: 0; }
.field-row:last-child { margin-bottom: 0; }
.field-value { min-width: 0; }
label { margin: 0; }
.path-row, .config-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
.parent-path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 2px; }
.file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.config-row :deep(vscode-dropdown) { flex: 1; min-width: 0; }
.option-row { display: flex; align-items: center; gap: 12px; }
.option-row label { margin: 0; }
.option-row :deep(vscode-dropdown) { margin-right: 18px; }
.option-row small { color: var(--vscode-descriptionForeground); font-size: 11px; }
.rules-heading { margin-top: 14px; font-weight: 600; }
.rules-note { display: block; margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; }
.rule-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin-top: 8px; }
.rule { display: flex; flex-direction: column; min-width: 0; }
.rule small { margin: 0 0 2px 22px; color: var(--vscode-descriptionForeground); font-size: 11px; }
.preview { margin-top: 16px; border: 1px solid var(--vscode-panel-border); min-width: 0; }
.preview-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 10px; background: var(--vscode-editorWidget-background); font-weight: 600; }
.preview-heading small { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: normal; }
.preview-status { font-size: 12px; }
.preview-status.matched { color: var(--vscode-testing-iconPassed); }
.preview-status.different { color: var(--vscode-errorForeground); }
.preview-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.preview-side { min-width: 0; border-top: 1px solid var(--vscode-panel-border); }
.preview-side + .preview-side { border-left: 1px solid var(--vscode-panel-border); }
.preview-label { padding: 5px 10px; color: var(--vscode-descriptionForeground); font-size: 11px; }
.preview pre { margin: 0; padding: 8px 0; min-height: 8em; overflow: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.4; }
.sql-line { display: block; padding: 0 10px; white-space: pre; }
.sql-line.removed { background: var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, .2)); }
.sql-line.added { background: var(--vscode-diffEditor-insertedTextBackground, rgba(0, 255, 0, .2)); }
@media (max-width: 900px) { .preview-columns { grid-template-columns: 1fr; } .preview-side + .preview-side { border-left: 0; } }
@media (max-width: 720px) { .columns, .rule-grid { grid-template-columns: 1fr; } .panel-header { flex-wrap: wrap; } }
</style>
