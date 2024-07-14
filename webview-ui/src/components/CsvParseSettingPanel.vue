<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type { CsvParseSettingPanelEventData, SaveCsvOptionParams } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import RDHViewer from "./RDHViewer.vue";

import type { ResultSetData } from "@l-v-yonsama/rdh";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeCheckbox());

const sectionHeight = ref(300);
const sectionRdhHeight = ref(300);
const sectionWidth = ref(300);
const fromLine = ref("");
const fromLineItems = ref([] as DropdownItem[]);
const message = ref("");

for (let i = 1; i <= 30; i++) {
  fromLineItems.value.push({
    label: `${i}`,
    value: `${i}`,
  });
}

const delimiter = ref(",");
const delimiterItems = ref([
  { label: "comma(,)", value: "," },
  { label: "tab(\\t)", value: "\t" },
  { label: "space( )", value: " " },
] as DropdownItem[]);

const firstLineAsColumn = ref(false);
const bom = ref(false);
const trim = ref(false);
const cast = ref(false);
const castDate = ref(false);
const initilizing = ref(true);

const rdh = ref(null as ResultSetData | null);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector(".csv-conditional-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 68, 100);
    sectionRdhHeight.value = Math.max(sectionHeight.value - 165, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = sectionWrapper.clientWidth - 50;
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const initialize = async (v: CsvParseSettingPanelEventData["value"]) => {
  if (v === undefined) {
    return;
  }

  initilizing.value = true;
  rdh.value = null;
  await nextTick();

  delimiter.value = v.initialize?.delimiter ?? ",";
  firstLineAsColumn.value = v.initialize?.columns === true;
  bom.value = v.initialize?.bom === true;
  trim.value = v.initialize?.trim === true;
  cast.value = v.initialize?.cast === true;
  castDate.value = v.initialize?.castDate === true;
  message.value = v.message ?? "";

  await nextTick();

  rdh.value = v.rdh;
  initilizing.value = false;
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const updateOptions = () => {
  ok(true);
};

const toNum = (s: string): number | undefined => {
  if (s == null || s === "") {
    return undefined;
  }
  const n = Number(s);
  if (isNaN(n)) {
    return undefined;
  }
  return n;
};

const ok = (preview: boolean) => {
  const params: SaveCsvOptionParams = {
    columns: firstLineAsColumn.value,
    delimiter: delimiter.value ?? ",",
    fromLine: toNum(fromLine.value),
    bom: bom.value,
    trim: trim.value,
    cast: cast.value,
    castDate: castDate.value,
    preview,
  };

  vscode.postCommand({
    command: "ok",
    params,
  });
};

const recieveMessage = (data: CsvParseSettingPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="csv-conditional-root">
    <div class="toolbar">
      <div class="tool-left"></div>
      <div class="tool-right">
        <VsCodeButton
          @click="cancel"
          appearance="secondary"
          title="Cancel"
          style="margin-right: 5px"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton @click="ok(false)" title="Show all"><fa icon="check" />Show all</VsCodeButton>
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="editor">
        <fieldset class="conditions">
          <legend>
            <span style="margin-right: 30px">Detail conditions</span>
          </legend>

          <div class="area">
            <div class="left">
              <div>
                <label for="fromLine">Handling line from:&nbsp;</label>
                <VsCodeDropdown
                  id="fromLine"
                  v-model="fromLine"
                  :items="fromLineItems"
                  style="z-index: 15"
                  @change="updateOptions()"
                />
              </div>

              <div>
                <vscode-checkbox
                  v-if="!initilizing"
                  :checked="firstLineAsColumn"
                  @change="($e:any) => {firstLineAsColumn = $e.target.checked; ok(true);}"
                  style="margin-right: auto"
                  >First line as column</vscode-checkbox
                >
              </div>
              <div>
                <vscode-checkbox
                  v-if="!initilizing"
                  :checked="bom"
                  @change="($e:any) => {bom = $e.target.checked; ok(true);}"
                  style="margin-right: auto"
                  >Strips the BOM</vscode-checkbox
                >
              </div>
            </div>
            <div class="right">
              <div>
                <label for="delimiter">Delimiter :&nbsp;</label>
                <VsCodeDropdown
                  id="delimiter"
                  v-model="delimiter"
                  :items="delimiterItems"
                  style="z-index: 15"
                  @change="updateOptions()"
                />
              </div>

              <div>
                <vscode-checkbox
                  v-if="!initilizing"
                  :checked="cast"
                  @change="($e:any) => {cast = $e.target.checked; ok(true);}"
                  style="margin-right: auto"
                  >Cast column type</vscode-checkbox
                >

                <vscode-checkbox
                  v-if="!initilizing"
                  :disabled="!cast"
                  :checked="castDate"
                  @change="($e:any) => {castDate = $e.target.checked; ok(true);}"
                  style="margin-right: auto"
                >
                  Also cast date type</vscode-checkbox
                >
              </div>
              <div>
                <vscode-checkbox
                  v-if="!initilizing"
                  :checked="trim"
                  @change="($e:any) => {trim = $e.target.checked; ok(true);}"
                  style="margin-right: auto"
                  >Ignore whitespace characters</vscode-checkbox
                >
              </div>
            </div>
          </div>
        </fieldset>
      </div>

      <fieldset class="preview">
        <legend>
          <span style="margin-right: 30px">Preview</span>
        </legend>
        <section :style="{ width: `${sectionWidth}px` }">
          <div v-if="rdh" class="spPaneWrapper">
            <RDHViewer
              :rdh="rdh"
              :width="sectionWidth"
              :height="sectionRdhHeight"
              :readonly="true"
              :with-type="true"
            />
          </div>
          <p v-else>{{ message }}</p>
        </section>
      </fieldset>
    </div>
  </section>
</template>

<style lang="scss" scoped>
section.csv-conditional-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  & > div {
    margin: 5px;
  }
}

div.toolbar {
  margin-bottom: 10px !important;

  .tool-left label {
    margin-left: 25px;
    margin-right: 5px;
  }
  .tool-left span {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    max-width: 180px;
  }
}

.scroll-wrapper {
  overflow: auto;
}

fieldset.conditions {
  margin-top: 0px;

  .area {
    display: flex;
    flex-direction: row;

    & > .right {
      margin-left: 4px;
      & > div {
        margin-bottom: 2px;
      }
    }
  }
}
fieldset.preview {
  margin-top: 15px;
}
</style>
