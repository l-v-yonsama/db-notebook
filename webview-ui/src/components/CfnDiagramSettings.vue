<script setup lang="ts">
import { vscode, type CfnDiagramSettingsPanelEventData } from "@/utilities/vscode";
import { computed, ref } from "vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckboxGroup from "./base/VsCodeCheckboxGroup.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroup from "./base/VsCodeRadioGroup.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";

const conName = ref("");
type StackItem = { name: string; status: string };
const stackItems = ref<StackItem[]>([]);
const selectedStackNames = ref<string[]>([]);

const stackGroups = computed(() => {
  const groups = new Map<string, { status: string; items: { label: string; value: string }[] }>();
  stackItems.value.forEach((stack) => {
    const group = groups.get(stack.status) ?? { status: stack.status, items: [] };
    group.items.push({ label: stack.name, value: stack.name });
    groups.set(stack.status, group);
  });
  return [...groups.values()];
});

type Mode = "ApplicationDiagram" | "MultiAzDeploymentDataPaths" | "CfnDependencyGraph";
const mode = ref<Mode>("ApplicationDiagram");
const modeItems: { label: string; value: Mode }[] = [
  { label: "ApplicationDiagram (runtime application flow)", value: "ApplicationDiagram" },
  {
    label: "CfnDependencyGraph (any resource, every real dependency)",
    value: "CfnDependencyGraph",
  },
  {
    label: "MultiAzDeploymentDataPaths (Multi-AZ placement and data paths)",
    value: "MultiAzDeploymentDataPaths",
  },
];

type Viewpoint =
  | "ApplicationView"
  | "InfrastructureView"
  | "SecurityView"
  | "DBView"
  | "OperationsView"
  | "CloudFormationView";
const viewpoint = ref<Viewpoint>("ApplicationView");
const viewpointItems: { label: string; value: Viewpoint }[] = [
  { label: "Application View", value: "ApplicationView" },
  { label: "Infrastructure View", value: "InfrastructureView" },
  { label: "Security View", value: "SecurityView" },
  { label: "DB View", value: "DBView" },
  { label: "Operations View", value: "OperationsView" },
  { label: "CloudFormation View (no filtering - every resource)", value: "CloudFormationView" },
];

type AuxiliaryTreatment = "MergeIntoLabel" | "SeparateGroup" | "Omit";
const auxiliaryTreatment = ref<AuxiliaryTreatment>("MergeIntoLabel");
const auxiliaryTreatmentItems: { label: string; value: AuxiliaryTreatment }[] = [
  { label: "Merge into the related resource's label", value: "MergeIntoLabel" },
  { label: "Separate group (own node, no edges)", value: "SeparateGroup" },
  { label: "Omit entirely", value: "Omit" },
];

type OutputFormat = "Mermaid" | "Drawio";
const outputFormat = ref<OutputFormat>("Mermaid");
const outputFormatItems: { label: string; value: OutputFormat; icon: string }[] = [
  { label: "Mermaid (preview notebook)", value: "Mermaid", icon: "file-code" },
  { label: "draw.io (editable XML file)", value: "Drawio", icon: "graph-line" },
];
const includeLegend = ref(true);

// viewpoint/auxiliaryTreatment only affect the Mermaid dependency graph. The draw.io
// dependency graph always includes every CloudFormation resource.
const viewpointControlsApply = () =>
  mode.value === "CfnDependencyGraph" && outputFormat.value === "Mermaid";
const viewpointControlsHint = () =>
  mode.value === "CfnDependencyGraph"
    ? "draw.io dependency graphs always include every CloudFormation resource."
    : "Not used by this diagram mode.";

const selectAllStacks = () => {
  selectedStackNames.value = stackItems.value.map((item) => item.name);
};

const clearStackSelection = () => {
  selectedStackNames.value = [];
};

const initialize = (v: CfnDiagramSettingsPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  conName.value = v.params.conName;
  stackItems.value = v.params.stacks.map((s) => ({ name: s.name, status: s.status }));
  selectedStackNames.value = [...v.params.initialSelectedStackNames];
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const generate = () => {
  vscode.postCommand({
    command: "createCfnDiagram",
    params: {
      stackNames: [...selectedStackNames.value],
      mode: mode.value,
      viewpoint: viewpoint.value,
      auxiliaryTreatment: auxiliaryTreatment.value,
      outputFormat: outputFormat.value,
      includeLegend: includeLegend.value,
    },
  });
};

const recieveMessage = (data: CfnDiagramSettingsPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <PanelActionToolbar @cancel="cancel">
      <template #left>
        <label>Connection: {{ conName }}</label>
      </template>
      <VsCodeButton :disabled="selectedStackNames.length === 0" @click="generate"
        title="Generate the diagram into preview.cfn-diagram.dbn">
        <fa icon="plus" />Generate
      </VsCodeButton>
    </PanelActionToolbar>
    <section class="content settings-grid">
      <aside class="stacks-panel">
        <div class="section-heading">
          <div>
            <h2>Stacks</h2>
            <p class="hint">Select the stacks to include.</p>
          </div>
          <span class="selection-count">{{ selectedStackNames.length }}/{{ stackItems.length }}</span>
        </div>
        <div class="stack-actions">
          <VsCodeButton appearance="secondary" :disabled="stackItems.length === 0" @click="selectAllStacks">
            <span class="codicon codicon-check-all"></span>Select all
          </VsCodeButton>
          <VsCodeButton appearance="secondary" :disabled="selectedStackNames.length === 0" @click="clearStackSelection">
            <span class="codicon codicon-clear-all"></span>Clear
          </VsCodeButton>
        </div>
        <div class="stack-list">
          <section v-for="group in stackGroups" :key="group.status" class="stack-group">
            <h3>{{ group.status }}</h3>
            <VsCodeCheckboxGroup v-model="selectedStackNames" :items="group.items" item-wrapper />
          </section>
          <p v-if="stackItems.length === 0" class="hint empty-state">No CloudFormation stacks found.</p>
        </div>
      </aside>

      <div class="options-panel">
        <div class="field">
          <label>Diagram mode</label>
          <VsCodeRadioGroup v-model="mode" :items="modeItems" />
        </div>
        <div class="field">
          <label>Viewpoint</label>
          <VsCodeDropdown v-model="viewpoint" :items="viewpointItems" :disabled="!viewpointControlsApply()" />
          <p v-if="!viewpointControlsApply()" class="hint">{{ viewpointControlsHint() }}</p>
        </div>
        <div class="field">
          <label>Auxiliary resource treatment</label>
          <VsCodeDropdown v-model="auxiliaryTreatment" :items="auxiliaryTreatmentItems"
            :disabled="!viewpointControlsApply()" />
          <p v-if="!viewpointControlsApply()" class="hint">{{ viewpointControlsHint() }}</p>
        </div>
        <div class="field">
          <label>Output format</label>
          <VsCodeRadioGroup v-model="outputFormat" :items="outputFormatItems" />
          <p class="hint">Mermaid opens the preview notebook. draw.io writes an editable XML file.</p>
        </div>
        <div class="field checkbox-field">
          <VsCodeCheckbox v-model="includeLegend">Include relationship legend</VsCodeCheckbox>
        </div>
      </div>
    </section>
  </section>
</template>

<style lang="scss" scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 1px;
  padding: 1px;
}

.content {
  padding: 12px;
  overflow: auto;
}

.settings-grid {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 2fr);
  gap: 16px;
  align-items: start;
}

.stacks-panel,
.options-panel {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
}

.stacks-panel {
  display: flex;
  flex-direction: column;
  min-height: 260px;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
}

.selection-count {
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.stack-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.stack-list {
  overflow: auto;
  max-height: calc(100vh - 220px);

  :deep(fieldset) {
    margin: 0;
    padding: 0;
    border: 0;
  }

}

.stack-group {
  margin-bottom: 14px;

  h3 {
    margin: 0 0 4px;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9rem;
    font-weight: 600;
  }

  &:last-child {
    margin-bottom: 0;
  }
}

.field {
  margin-bottom: 16px;

  label {
    display: block;
    margin-bottom: 4px;
    font-weight: bold;
  }
}

.options-panel {
  :deep(vscode-radio) {
    margin: 8px 0;
  }

  :deep(.codicon) {
    margin-right: 6px;
  }
}

.stack-actions :deep(.codicon) {
  margin-right: 6px;
}

.hint {
  margin: 4px 0 0;
  font-size: 0.9em;
  opacity: 0.75;
}

.empty-state {
  margin-top: 16px;
}

@media (max-width: 720px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .stack-list {
    max-height: 240px;
  }
}
</style>
