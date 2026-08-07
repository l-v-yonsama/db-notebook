<script setup lang="ts">
import { vscode, type CfnDiagramSettingsPanelEventData } from "@/utilities/vscode";
import { ref } from "vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckboxGroup from "./base/VsCodeCheckboxGroup.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroup from "./base/VsCodeRadioGroup.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";

const conName = ref("");
const stackItems = ref<{ label: string; value: string }[]>([]);
const selectedStackNames = ref<string[]>([]);

type Mode = "ApplicationDiagram" | "CfnDependencyGraph" | "ArchitectureDiagram";
const mode = ref<Mode>("ApplicationDiagram");
const modeItems: { label: string; value: Mode }[] = [
  { label: "ApplicationDiagram (runtime application flow)", value: "ApplicationDiagram" },
  { label: "CfnDependencyGraph (any resource, every real dependency)", value: "CfnDependencyGraph" },
  { label: "ArchitectureDiagram (VPC/Subnet network layout)", value: "ArchitectureDiagram" },
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
const outputFormatItems: { label: string; value: OutputFormat }[] = [
  { label: "Mermaid (preview notebook)", value: "Mermaid" },
  { label: "draw.io (editable XML file)", value: "Drawio" },
];
const includeLegend = ref(true);

// viewpoint/auxiliaryTreatment only affect CfnDependencyGraph. ApplicationDiagram selects
// runtime relationships and ArchitectureDiagram draws its fixed VPC/AZ/Subnet layout.
const viewpointControlsApply = () => mode.value === "CfnDependencyGraph";

const initialize = (v: CfnDiagramSettingsPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  conName.value = v.params.conName;
  stackItems.value = v.params.stacks.map((s) => ({
    label: `${s.name} (${s.status})`,
    value: s.name,
  }));
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
    <section class="content">
      <div class="field">
        <label>Stacks (target of the diagram)</label>
        <VsCodeCheckboxGroup v-model="selectedStackNames" :items="stackItems" />
      </div>
      <div class="field">
        <label>Mode</label>
        <VsCodeRadioGroup v-model="mode" :items="modeItems" />
      </div>
      <div class="field">
        <label>Viewpoint</label>
        <VsCodeDropdown v-model="viewpoint" :items="viewpointItems" :disabled="!viewpointControlsApply()" />
        <p v-if="!viewpointControlsApply()" class="hint">Not used by ArchitectureDiagram mode.</p>
      </div>
      <div class="field">
        <label>Auxiliary resource treatment</label>
        <VsCodeDropdown v-model="auxiliaryTreatment" :items="auxiliaryTreatmentItems"
          :disabled="!viewpointControlsApply()" />
        <p v-if="!viewpointControlsApply()" class="hint">Not used by ArchitectureDiagram mode.</p>
      </div>
      <div class="field">
        <label>Output format</label>
        <VsCodeDropdown v-model="outputFormat" :items="outputFormatItems" />
        <p class="hint">Mermaid opens the preview notebook. draw.io writes an editable XML file.</p>
      </div>
      <div class="field checkbox-field">
        <VsCodeCheckbox v-model="includeLegend">Include relationship legend</VsCodeCheckbox>
      </div>
    </section>
  </section>
</template>

<style scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 1px;
  padding: 1px;
}

.content {
  padding: 8px;
  overflow: auto;
}

.field {
  margin-bottom: 16px;
}

.field label {
  display: block;
  margin-bottom: 4px;
  font-weight: bold;
}

.hint {
  margin: 4px 0 0;
  font-size: 0.9em;
  opacity: 0.75;
}
</style>
