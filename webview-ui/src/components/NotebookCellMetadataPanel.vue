<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type { NotebookCellMetadataPanelEventData } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { isDateTimeOrDateOrTime, isNumericLike } from "@l-v-yonsama/rdh";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
import { computed, nextTick, onMounted, ref } from "vue";
import type { CellMetaChart } from "../../../src/types/Notebook";
import TextOrDropdown from "./base/TextOrDropdown.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const codeFileItems: DropdownItem[] = [];
const ruleFileItems: DropdownItem[] = [];
const chartTypeItems: DropdownItem[] = [
  { label: "Unused", value: "Unused" },
  { label: "Bar Chart", value: "bar" },
  { label: "Doughnut", value: "doughnut" },
  { label: "Line Chart", value: "line" },
  { label: "Pie", value: "pie" },
  { label: "Radar Chart", value: "radar" },
  { label: "Scatter Chart", value: "scatter" },
  { label: "Pair plot", value: "pairPlot" },
];
const chartLabelItems: DropdownItem[] = [];
const chartDataItems: DropdownItem[] = [];

const showComment = ref(false);
const codeResolverFile = ref("");
const ruleFile = ref("");
const chartMultipleDataset = ref(false);
const chartShowDataLabels = ref(false);
const chartShowTitle = ref(false);
const chartStacked = ref(false);
const chartTitle = ref("");
const chartType = ref("Unused");
const chartLabel = ref("");
const chartData = ref("");
const chartData2 = ref("");
const chartData3 = ref("");
const chartData4 = ref("");
const chartDataX = ref("");
const chartDataY = ref("");
const savingSharedVariables = ref(false);
const sharedVariableName = ref("");

const initialized = ref(false);
const sectionHeight = ref(300);

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 56, 100);
  }
};

const initialize = (v: NotebookCellMetadataPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  initialized.value = false;
  const keys = v.columnItems;

  nextTick(() => {
    showComment.value = v.metadata.showComment === true;

    codeResolverFile.value = v.metadata.codeResolverFile ?? "";
    ruleFile.value = v.metadata.ruleFile ?? "";

    v.codeFileItems.map((it) => {
      codeFileItems.push({ label: it.label, value: it.value });
    });
    v.ruleFileItems.map((it) => {
      ruleFileItems.push({ label: it.label, value: it.value });
    });

    chartLabelItems.push({ label: " -- ", value: "" });
    chartDataItems.push({ label: " -- ", value: "" });
    keys.map((it) => {
      const label = `${it.name}${it.comment ? " (" + it.comment + ")" : ""}`;
      chartLabelItems.push({ label, value: it.name });
      if (isNumericLike(it.type) || isDateTimeOrDateOrTime(it.type))
        chartDataItems.push({ label, value: it.name });
    });
    chartMultipleDataset.value = v.metadata.chart?.multipleDataset === true;
    chartShowDataLabels.value = v.metadata.chart?.showDataLabels === true;
    chartShowTitle.value = v.metadata.chart?.showTitle === true;
    chartStacked.value = v.metadata.chart?.stacked === true;
    chartTitle.value = v.metadata.chart?.title ?? "";
    chartType.value = v.metadata.chart?.type ?? "Unused";
    chartLabel.value = v.metadata.chart?.label ?? "";
    chartData.value = v.metadata.chart?.data ?? "";
    chartData2.value = v.metadata.chart?.data2 ?? "";
    chartData3.value = v.metadata.chart?.data3 ?? "";
    chartData4.value = v.metadata.chart?.data4 ?? "";
    chartDataX.value = v.metadata.chart?.dataX ?? "";
    chartDataY.value = v.metadata.chart?.dataY ?? "";

    savingSharedVariables.value = v.metadata.savingSharedVariables === true;
    sharedVariableName.value = v.metadata.sharedVariableName ?? "";

    initialized.value = true;
  });
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
  setTimeout(resetSpPaneWrapperHeight, 50);
  setTimeout(resetSpPaneWrapperHeight, 200);
});

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const save = () => {
  vscode.postCommand({
    command: "saveNotebookCellMetadata",
    params: {
      metadata: {
        showComment: showComment.value,
        codeResolverFile: codeResolverFile.value,
        ruleFile: ruleFile.value,
        savingSharedVariables: savingSharedVariables.value,
        sharedVariableName: sharedVariableName.value,
        chart:
          chartType.value === "Unused"
            ? undefined
            : {
                multipleDataset: chartMultipleDataset.value,
                showDataLabels: chartShowDataLabels.value,
                showTitle: chartShowTitle.value,
                stacked: chartStacked.value,
                title: chartTitle.value,
                type: chartType.value as CellMetaChart["type"],
                label: chartLabel.value,
                data: chartData.value,
                data2: chartData2.value,
                data3: chartData3.value,
                data4: chartData4.value,
                dataX: chartDataX.value,
                dataY: chartDataY.value,
              },
      },
    },
  });
};

const recieveMessage = (data: NotebookCellMetadataPanelEventData) => {
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

const handleChangeType = () => {
  // initialize
  chartLabel.value = "";
};

const disabledSaveButton = computed(
  () => savingSharedVariables.value && sharedVariableName.value.length === 0
);

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <div class="toolbar">
      <div class="tool-left"></div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton :disabled="disabledSaveButton" @click="save" title="Save cell metadata"
          ><fa icon="plus" />Save</VsCodeButton
        >
      </div>
    </div>
    <section v-if="!initialized" class="content">Initializing...</section>
    <section v-else class="content scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <fieldset>
        <legend>SQL Editor</legend>
        <div>
          <vscode-checkbox
            :checked="showComment"
            @change="($e:any) => showComment =$e.target.checked"
            style="margin-right: auto"
            >Display comments after each resource</vscode-checkbox
          >
        </div>
      </fieldset>
      <fieldset>
        <legend>Resultset decoration</legend>
        <div>
          <p>Resolve code values to labels and display them in the resultset</p>
          <VsCodeDropdown id="codeFileItems" v-model="codeResolverFile" :items="codeFileItems" />
        </div>
      </fieldset>
      <fieldset>
        <legend>Resultset validation</legend>
        <div>
          <p>Verify each records by the record rule file</p>
          <VsCodeDropdown id="ruleFileItems" v-model="ruleFile" :items="ruleFileItems" />
        </div>
      </fieldset>
      <fieldset>
        <legend>Saving execution results in shared variables</legend>
        <div>
          <div>
            <vscode-checkbox
              :checked="savingSharedVariables"
              @change="($e:any) => savingSharedVariables =$e.target.checked"
              style="margin-right: auto"
              >Save</vscode-checkbox
            >
          </div>
          <div v-if="savingSharedVariables">
            <label for="sharedVariableName">shared variable name:</label>
            <VsCodeTextField
              id="sharedVariableName"
              v-model="sharedVariableName"
              :required="true"
              :maxlength="50"
              :transparent="true"
              :change-on-mouseout="true"
              title="Shared variable name"
            >
            </VsCodeTextField>
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Chart</legend>
        <div>
          <div class="dropdown-area">
            <label for="chartType">Type:</label>
            <VsCodeDropdown
              id="chartType"
              v-model="chartType"
              :items="chartTypeItems"
              @change="handleChangeType"
            />
          </div>

          <div v-if="chartType !== 'Unused'">
            <div class="dropdown-area">
              <label for="chartTitle">Title:</label>
              <VsCodeTextField
                id="chartTitle"
                v-model="chartTitle"
                :transparent="true"
                :required="true"
              />
              <vscode-checkbox
                id="chartShowTitle"
                :checked="chartShowTitle"
                @change="($e:any) => chartShowTitle =$e.target.checked"
                style="margin-right: auto; margin-left: 10px"
                >Displays title on chart</vscode-checkbox
              >
            </div>
            <div v-if="chartType !== 'radar'" class="dropdown-area">
              <label for="chartShowDataLabels">Data values:</label>
              <vscode-checkbox
                id="chartShowDataLabels"
                :checked="chartShowDataLabels"
                @change="($e:any) => chartShowDataLabels =$e.target.checked"
                style="margin-right: auto"
                >Displays values on data</vscode-checkbox
              >
            </div>
            <div
              v-if="
                chartType !== 'pairPlot' &&
                chartType !== 'radar' &&
                chartType !== 'scatter' &&
                chartType !== 'doughnut' &&
                chartType !== 'pie'
              "
              class="dropdown-area"
            >
              <label for="chartMultipleDataset">Databset:</label>
              <vscode-checkbox
                id="chartMultipleDataset"
                :checked="chartMultipleDataset"
                @change="($e:any) => chartMultipleDataset =$e.target.checked"
                style="margin-right: auto"
                >Multiple</vscode-checkbox
              >
            </div>

            <div v-if="chartType === 'doughnut' || chartType === 'pie'">
              <TextOrDropdown
                v-model="chartLabel"
                label="*Labels"
                :chartDataItems="chartLabelItems"
                :required="true"
              />
              <TextOrDropdown
                v-model="chartData"
                label="*Data"
                :chartDataItems="chartDataItems"
                :required="true"
              />
            </div>
            <div v-else-if="chartType === 'scatter'">
              <TextOrDropdown
                v-model="chartDataX"
                label="*Data X"
                :chartDataItems="chartDataItems"
                :required="true"
              />
              <TextOrDropdown
                v-model="chartDataY"
                label="*Data Y"
                :chartDataItems="chartDataItems"
                :required="true"
              />
              <TextOrDropdown
                v-model="chartLabel"
                label="*Group(Hue)"
                :chartDataItems="chartLabelItems"
              />
            </div>
            <div v-else-if="chartType === 'bar'">
              <TextOrDropdown
                v-model="chartLabel"
                label="*Label(X)"
                :chartDataItems="chartLabelItems"
                :required="true"
              />
              <TextOrDropdown
                v-model="chartData"
                label="*Data(Y)"
                :chartDataItems="chartDataItems"
                :required="true"
              />
              <div v-if="chartMultipleDataset">
                <TextOrDropdown
                  v-model="chartData2"
                  label="*Data(Y2)"
                  :chartDataItems="chartDataItems"
                />
                <TextOrDropdown
                  v-model="chartData3"
                  label="*Data(Y3)"
                  :chartDataItems="chartDataItems"
                />
                <TextOrDropdown
                  v-model="chartData4"
                  label="*Data(Y4)"
                  :chartDataItems="chartDataItems"
                />
                <div>
                  <label for="chartStacked">Stacked:</label>
                  <vscode-checkbox
                    id="chartStacked"
                    :checked="chartStacked"
                    @change="($e:any) => chartStacked =$e.target.checked"
                    style="margin-right: auto"
                    >ON</vscode-checkbox
                  >
                </div>
              </div>
            </div>
            <div v-else-if="chartType === 'radar'">
              <TextOrDropdown
                v-model="chartData"
                label="*Data"
                :chartDataItems="chartDataItems"
                :required="true"
              />
              <TextOrDropdown
                v-model="chartData2"
                label="*Data2"
                :chartDataItems="chartDataItems"
                :required="true"
              />
              <TextOrDropdown
                v-model="chartData3"
                label="*Data3"
                :chartDataItems="chartDataItems"
              />
              <TextOrDropdown
                v-model="chartData4"
                label="*Data4"
                :chartDataItems="chartDataItems"
              />
              <TextOrDropdown
                v-model="chartLabel"
                label="*Group(Hue)"
                :chartDataItems="chartLabelItems"
              />
            </div>
            <div v-else-if="chartType === 'line'">
              <TextOrDropdown
                v-model="chartLabel"
                label="*Labels(X)"
                :chartDataItems="chartLabelItems"
                :required="true"
              />
              <TextOrDropdown
                v-model="chartData"
                label="*Data(Y)"
                :chartDataItems="chartDataItems"
                :required="true"
              />
              <div v-if="chartMultipleDataset">
                <TextOrDropdown
                  v-model="chartData2"
                  label="*Data(Y2)"
                  :chartDataItems="chartDataItems"
                />
                <TextOrDropdown
                  v-model="chartData3"
                  label="*Data(Y3)"
                  :chartDataItems="chartDataItems"
                />
                <TextOrDropdown
                  v-model="chartData4"
                  label="*Data(Y4)"
                  :chartDataItems="chartDataItems"
                />
              </div>
            </div>
            <div v-if="chartType === 'pairPlot'">
              <TextOrDropdown v-model="chartLabel" label="*Hue" :chartDataItems="chartLabelItems" />
            </div>
            <p>
              * By pre-executing a SELECT statement, the target column can be selected from a
              drop-down.
            </p>
          </div>
        </div>
      </fieldset>
    </section>
  </section>
</template>

<style lang="scss" scoped>
section.root {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;

  & > * {
    margin: 10px;
  }
}

fieldset {
  margin-bottom: 15px;
}
.scroll-wrapper {
  overflow: auto;
}

div.dropdown-area {
  margin-bottom: 3px;
  & > label {
    margin-top: 5px;
    display: inline-block;
    margin-right: 5px;
    min-width: 85px;
  }
}
</style>
