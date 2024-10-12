<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import {
  vscode,
  type DynamoDBConditionParams,
  type DynamoQueryFilter,
  type DynamoQueryPanelEventData,
  type UpdateTextDocumentActionCommand
} from "@/utilities/vscode";
import {
  provideVSCodeDesignSystem,
  vsCodeCheckbox,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

provideVSCodeDesignSystem().register(
  vsCodeCheckbox(),
  vsCodePanelView(),

);

const OPERATORS: DropdownItem[] = [
  { label: "-", value: "" },
  { label: "=", value: "equal" },
  { label: "<", value: "lessThan" },
  { label: "≦", value: "lessThanInclusive" },
  { label: ">", value: "greaterThan" },
  { label: "≧", value: "greaterThanInclusive" },
  { label: "BETWEEN", value: "between" },
  { label: "BEGINS WITH", value: "beginsWith" },
];

const FILTER_OPERATORS: DropdownItem[] = [
  ...OPERATORS,
  { label: "CONTAINS", value: "contains" },
];


const ONLY_EQUAL_OPERATORS: DropdownItem[] = [
  { label: "=", value: "equal" },
];

const inProgress = ref(false);
const tableName = ref("");
const sortDesc = ref(false);
const pkOpe = ref("");
const skOpe = ref("");
const pkName = ref("");
const skName = ref("");
const pkAttr = ref("");
const skAttr = ref("");
const pkValue = ref("");
const skValue = ref("");
const limit = ref("0");
const previewInput = ref("0");
const numOfRows = ref(0);
let limitMax = 100000;
const splitterWidth = ref(300);
const sectionHeight = ref(300);
const targetItems = ref([] as DropdownItem[]);
const columnItems = ref([] as DropdownItem[]);
const filters = ref([] as DynamoQueryFilter[]);
const target = ref("");

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.DynamoQueryPanel");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 60, 10);
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = sectionWrapper.clientWidth - 14;
  }
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
  setTimeout(resetSpPaneWrapperHeight, 50);
  setTimeout(resetSpPaneWrapperHeight, 200);
});

const executable = computed(() => pkValue.value.length > 0);

const initialize = async (v: DynamoQueryPanelEventData["value"]["initialize"]): Promise<void> => {
  if (v === undefined) {
    return;
  }
  const { tableRes } = v;

  tableName.value = tableRes.name;
  target.value = v.target;
  sortDesc.value = v.sortDesc;
  pkName.value = v.pkName;
  pkAttr.value = v.pkAttr;
  pkValue.value = v.pkValue;
  skName.value = v.skName;
  skAttr.value = v.skAttr;
  skValue.value = v.skValue;
  limit.value = (v.limit ?? 100) + "";
  filters.value.splice(0, filters.value.length);
  numOfRows.value = v.numOfRows;
  limitMax = Math.max(100000, v.numOfRows);
  previewInput.value = v.previewInput;
  targetItems.value.splice(0, targetItems.value.length);
  columnItems.value.splice(0, columnItems.value.length);

  await nextTick();

  filters.value.push(...v.filters);
  columnItems.value.push({ label: "-", value: "" });
  columnItems.value.push(...v.columnItems);

  targetItems.value.push({
    label: "TABLE",
    value: "$table",
  });

  tableRes.attr.lsi.forEach((it, idx) => {
    targetItems.value.push({
      label: `LSI(${idx + 1}):${it.IndexName} (${it.KeySchema?.map((it) => it.AttributeName).join(",")})`,
      value: "$lsi:" + it.IndexName,
    });
  });
  tableRes.attr.gsi.forEach((it, idx) => {
    targetItems.value.push({
      label: `GSI(${idx + 1}):${it.IndexName} (${it.KeySchema?.map((it) => it.AttributeName).join(",")})`,
      value: "$gsi:" + it.IndexName,
    });
  });

};

const addFilter = () => {
  filters.value.push({
    name: "",
    operator: "",
    value: "",
  });
};

const stopProgress = (): void => {
  inProgress.value = false;
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};
const ok = (preview: boolean) => {
  const params: DynamoDBConditionParams = {
    target: target.value,
    pkValue: pkValue.value,
    skValue: skValue.value,
    skOpe: skOpe.value,
    sortDesc: sortDesc.value,
    filters: JSON.parse(JSON.stringify(filters.value ?? [])),
    limit: limit.value === "" ? 100 : Number(limit.value),
    preview
  };
  console.log("l158 ", params);
  vscode.postCommand({
    command: "ok",
    params,
  });
};
const updateOptions = () => {
  ok(true);
};
const updateFilter = (idx: number) => {
  const filter = filters.value[idx];
  if (filter.name !== "" && filter.operator !== "" && filter.value !== "") {
    ok(true);
  }
};
const deleteFilter = (idx: number) => {
  filters.value.splice(idx, 1);
  ok(true);
};
const updateTextDocument = (values?: UpdateTextDocumentActionCommand["params"]["values"]) => {
  ok(true);
};
const setSortDesc = (v: boolean) => {
  sortDesc.value = v;
  ok(true);
};

const recieveMessage = (data: DynamoQueryPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
    case "stop-progress":
      stopProgress();
      break;
  }
};



defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="DynamoQueryPanel">
    <div class="toolbar">
      <div class="tool-left">
        <label for="tableName">Table:</label>
        <span id="tableName">{{ tableName }}</span>
        <label for="numOfRows">Estimated items:</label>
        <span id="numOfRows">{{ numOfRows }}</span>
        <label for="limit">Limit:</label>
        <VsCodeTextField id="limit" v-model="limit" :min="0" :max="limitMax" style="width: 100px" type="number"
          title="number of rows returned" placeholder="number of rows returned" @change="updateTextDocument()">
        </VsCodeTextField>
        <label for="target">Table or Index:</label>
        <VsCodeDropdown id="target" v-model="target" :items="targetItems" style="z-index: 15; width:200px"
          @change="updateOptions()" />
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel" style="margin-right: 5px">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton :disabled="!executable" @click="ok(false)" title="Execute">
          <fa icon="check" />Execute
        </VsCodeButton>
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="settings">
        <div class="editor">
          <fieldset class="conditions">
            <legend>
              <span style="margin-right: 30px">Key conditions</span>
            </legend>
            <div>
              <label for="pk">Partial key ({{ pkName }} [{{ pkAttr }}] ):</label>
              <VsCodeDropdown v-model="pkOpe" :items="ONLY_EQUAL_OPERATORS" style="z-index: 15; width:160px" />
              <VsCodeTextField id="pk" v-model="pkValue" style="width: 200px" @change="updateTextDocument()"
                :required="true" :change-on-mouseout="true">
              </VsCodeTextField>
            </div>
            <div v-if="skName">
              <label for="sk">Sort key ({{ skName }} [{{ skAttr }}] ):</label>
              <VsCodeDropdown v-model="skOpe" :items="OPERATORS" style="z-index: 15; width:160px"
                @change="updateOptions()" />
              <VsCodeTextField id="sk" v-model="skValue" style="width: 200px" @change="updateTextDocument()"
                :change-on-mouseout="true">
              </VsCodeTextField>
              <span v-if="skOpe === 'between'" style="font-size: small; margin-left:5px;opacity: 0.7;"> *Separate by
                comma</span>
              <vscode-checkbox :checked="sortDesc" @change="($e: any) => setSortDesc($e.target.checked)"
                style="margin-left: 8px; font-size: small; opacity: 0.7;">Sort descending order</vscode-checkbox>
            </div>
          </fieldset>
          <fieldset class="filter">
            <legend>
              <span>Filter expressions</span>
              <VsCodeButton @click="addFilter" style="margin-left: 30px">
                <fa icon="plus" />Add filter
              </VsCodeButton>
            </legend>
            <table v-if="filters.length">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Name</th>
                  <th>Operator</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(filter, idx) of filters" :key="idx">
                  <td>
                    <VsCodeButton appearance="secondary" class="delete" @click="deleteFilter(idx)"
                      title="Delete a filter">
                      <span class="codicon codicon-trash"></span>Delete
                    </VsCodeButton>
                  </td>
                  <td>
                    <VsCodeDropdown v-model="filter.name" :items="columnItems" style="z-index: 15; width:160px"
                      @change="updateFilter(idx)" />
                  </td>
                  <td>
                    <VsCodeDropdown v-model="filter.operator" :items="FILTER_OPERATORS" style="z-index: 15; width:160px"
                      @change="updateFilter(idx)" />
                  </td>
                  <td>
                    <VsCodeTextField v-model="filter.value" style="width: 200px" @change="updateFilter(idx)">
                    </VsCodeTextField>
                    <span v-if="filter.operator === 'between'" style="font-size: small; margin-left:5px;opacity: 0.7;">
                      *Separate
                      by
                      comma</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </fieldset>
        </div>
        <fieldset class="conditions">
          <legend>Preview</legend>
          <p class="preview" v-text="previewInput"></p>
        </fieldset>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
section.DynamoQueryPanel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  &>div {
    margin: 5px;

    &.toolbar {
      margin-bottom: 0px !important;

      .tool-left {
        label {
          margin-right: 5px;
        }

        label:nth-child(n+2) {
          margin-left: 25px;
        }

        span {
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          max-width: 180px;
        }
      }
    }

    &.scroll-wrapper {
      overflow: auto;

      fieldset.conditions {
        margin-top: 7px;

        div {
          margin-top: 5px;

          label {
            min-width: 180px;
            display: inline-block;
          }

          vscode-dropdown {
            margin-right: 6px;
          }
        }
      }

      fieldset.filter {
        margin-top: 10px;
      }

      p.preview {
        margin: 5px;
        white-space: pre-wrap;
      }
    }
  }
}
</style>
