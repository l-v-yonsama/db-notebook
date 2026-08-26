<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import {
  vscode,
  type DynamoDBConditionParams,
  type DynamoQueryFilter,
  type DynamoQueryPanelEventData,
  type DynamoQueryProjectionConstraintView,
  type DynamoQueryProjectionMode,
  type UpdateTextDocumentActionCommand
} from "@/utilities/vscode";
import {
  provideVSCodeDesignSystem,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import { computed, nextTick, onMounted, ref } from "vue";
import PanelActionToolbar from "./base/PanelActionToolbar.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckbox from "./base/VsCodeCheckbox.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

provideVSCodeDesignSystem().register(
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

const projectionMode = ref<DynamoQueryProjectionMode>("default");
const projectedAttributes = ref<string[]>([]);
const consistentRead = ref(false);
const projectionConstraint = ref<DynamoQueryProjectionConstraintView>({
  availableAttributes: [],
  projectedAttributes: [],
  allowAllTableAttributesOption: false,
  restrictToProjected: false,
  consistentReadAllowed: true,
});

const projectionModeItems = computed((): DropdownItem[] => {
  const items: DropdownItem[] = [
    { label: "Default for target", value: "default" },
    { label: "Specific attributes", value: "specific" },
  ];
  if (projectionConstraint.value.allowAllTableAttributesOption) {
    items.push({ label: "All table attributes", value: "allTableAttributes" });
  }
  return items;
});

// Whether `attr` is unselectable in the "Specific attributes" list - only
// ever true for a GSI with a known KEYS_ONLY/INCLUDE Projection (design doc
// §6.1's GSI rule: a non-projected attribute can't be fetched at all).
const isAttributeSelectable = (attr: string): boolean => {
  if (!projectionConstraint.value.restrictToProjected) {
    return true;
  }
  return projectionConstraint.value.projectedAttributes?.includes(attr) ?? false;
};

// LSI-only advisory: true when `attr` is selectable but not part of the
// target's own Projection, meaning DynamoDB may need an extra base-table
// fetch (latency/Capacity) to return it (design doc §6.1/§14).
const isAttributeNonProjected = (attr: string): boolean => {
  const projected = projectionConstraint.value.projectedAttributes;
  if (projected === undefined) {
    return false;
  }
  return !projected.includes(attr);
};

const projectionHasNonProjectedSelection = computed(
  () => projectionMode.value === "allTableAttributes"
    ? projectionConstraint.value.allowAllTableAttributesOption &&
      projectionConstraint.value.projectedAttributes !== undefined &&
      projectionConstraint.value.projectedAttributes.length < projectionConstraint.value.availableAttributes.length
    : projectionMode.value === "specific" && projectedAttributes.value.some(isAttributeNonProjected)
);

const projectionMetadataUnknown = computed(
  () => projectionConstraint.value.projectedAttributes === undefined
);

const toggleProjectedAttribute = (attr: string, checked: boolean) => {
  const idx = projectedAttributes.value.indexOf(attr);
  if (checked && idx < 0) {
    projectedAttributes.value.push(attr);
  } else if (!checked && idx >= 0) {
    projectedAttributes.value.splice(idx, 1);
  }
  ok(true);
};

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

const projectionSelectionValid = computed(
  () => projectionMode.value !== "specific" || projectedAttributes.value.length > 0
);
const executable = computed(() => pkValue.value.length > 0 && projectionSelectionValid.value);

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
  projectionMode.value = v.projectionMode;
  projectedAttributes.value.splice(0, projectedAttributes.value.length, ...v.projectedAttributes);
  consistentRead.value = v.consistentRead;
  projectionConstraint.value = v.projectionConstraint;

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
    projectionMode: projectionMode.value,
    projectedAttributes: JSON.parse(JSON.stringify(projectedAttributes.value ?? [])),
    consistentRead: consistentRead.value,
    preview
  };

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
    <PanelActionToolbar @cancel="cancel">
      <template #left>
        <label for="tableName">Table:</label>
        <span id="tableName">{{ tableName }}</span>
        <label for="numOfRows">Estimated items:</label>
        <span id="numOfRows">{{ numOfRows }}</span>
        <label for="limit">Max returned items:</label>
        <VsCodeTextField id="limit" v-model="limit" :min="0" :max="limitMax" style="width: 100px" type="number"
          title="The panel may issue multiple Query requests. This limit caps items retained in the result, not the total number of items DynamoDB may evaluate across all requests."
          placeholder="max returned items" @change="updateTextDocument()">
        </VsCodeTextField>
        <label for="target">Table or Index:</label>
        <VsCodeDropdown id="target" v-model="target" :items="targetItems" style="width:200px"
          @change="updateOptions()" />
      </template>
      <VsCodeButton :disabled="!executable" @click="ok(false)" title="Execute">
        <fa icon="check" />Execute
      </VsCodeButton>
    </PanelActionToolbar>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="settings">
        <div class="editor">
          <fieldset class="conditions">
            <legend>
              <span style="margin-right: 30px">Key conditions</span>
            </legend>
            <div>
              <label for="pk">Partition key ({{ pkName }} [{{ pkAttr }}] ):</label>
              <VsCodeDropdown v-model="pkOpe" :items="ONLY_EQUAL_OPERATORS" style="width:160px" />
              <VsCodeTextField id="pk" v-model="pkValue" style="width: 200px" @change="updateTextDocument()"
                :required="true" :change-on-mouseout="true">
              </VsCodeTextField>
            </div>
            <div v-if="skName">
              <label for="sk">Sort key ({{ skName }} [{{ skAttr }}] ):</label>
              <VsCodeDropdown v-model="skOpe" :items="OPERATORS" style="width:160px"
                @change="updateOptions()" />
              <VsCodeTextField id="sk" v-model="skValue" style="width: 200px" @change="updateTextDocument()"
                :change-on-mouseout="true">
              </VsCodeTextField>
              <span v-if="skOpe === 'between'" style="font-size: small; margin-left:5px;opacity: 0.7;"> *Separate by
                comma</span>
              <VsCodeCheckbox v-model="sortDesc" @change="ok(true)"
                style="margin-left: 8px; font-size: small; opacity: 0.7;">Sort descending order</VsCodeCheckbox>
            </div>
            <div>
              <label for="consistentRead">Read consistency:</label>
              <VsCodeCheckbox id="consistentRead" v-model="consistentRead"
                :disabled="!projectionConstraint.consistentReadAllowed" @change="ok(true)"
                :title="projectionConstraint.consistentReadAllowed ? 'Use a strongly consistent read (table/LSI only)' : 'A GSI cannot use a strongly consistent read'">
                Strongly consistent read
              </VsCodeCheckbox>
            </div>
          </fieldset>
          <fieldset class="conditions">
            <legend>
              <span>Returned attributes (Projection)</span>
            </legend>
            <div>
              <label for="projectionMode">Mode:</label>
              <VsCodeDropdown id="projectionMode" v-model="projectionMode" :items="projectionModeItems"
                style="width:220px" @change="updateOptions()" />
            </div>
            <div v-if="projectionMode === 'specific'" class="projection-attributes">
              <label>Attributes:</label>
              <span v-for="attr in projectionConstraint.availableAttributes" :key="attr" class="projection-attribute">
                <VsCodeCheckbox :model-value="projectedAttributes.includes(attr)"
                  :disabled="!isAttributeSelectable(attr)"
                  :title="!isAttributeSelectable(attr) ? 'Not projected onto this GSI - cannot be returned by this Query.' : (isAttributeNonProjected(attr) ? 'Not projected onto this LSI - returning it may require an extra base-table fetch (added latency/Capacity).' : '')"
                  @change="(checked: boolean) => toggleProjectedAttribute(attr, checked)">
                  {{ attr }}<span v-if="isAttributeSelectable(attr) && isAttributeNonProjected(attr)"
                    class="projection-warning-mark">*</span>
                </VsCodeCheckbox>
              </span>
              <p v-if="projectionMetadataUnknown" class="hint">
                *Projection metadata for this target is unknown (e.g. a custom endpoint) - these constraints could
                not be verified.
              </p>
              <p v-else-if="projectionHasNonProjectedSelection" class="hint">
                *Not projected onto this index - DynamoDB may need an extra base-table fetch to return it, adding
                latency/Capacity.
              </p>
              <p v-if="projectedAttributes.length === 0" class="hint">
                Select at least one attribute before previewing or executing this Query.
              </p>
            </div>
            <p v-else-if="projectionMode === 'allTableAttributes' && projectionHasNonProjectedSelection" class="hint">
              This LSI does not project every known table attribute. Returning all table attributes may require
              extra base-table fetches, adding latency and Capacity.
            </p>
            <p class="hint">
              Projection reduces the returned payload; for a table Query it does not by itself reduce Read Capacity,
              since the same items are still read.
            </p>
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
                    <VsCodeDropdown v-model="filter.name" :items="columnItems" style="width:160px"
                      @change="updateFilter(idx)" />
                  </td>
                  <td>
                    <VsCodeDropdown v-model="filter.operator" :items="FILTER_OPERATORS" style="width:160px"
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

      .projection-attributes {
        display: flex;
        flex-wrap: wrap;
        align-items: center;

        label {
          min-width: auto !important;
          margin-right: 6px;
        }
      }

      .projection-attribute {
        margin-right: 14px;
        margin-bottom: 4px;
        display: inline-flex;
        align-items: center;
      }

      .projection-warning-mark {
        color: var(--vscode-charts-yellow, orange);
        margin-left: 2px;
      }

      p.hint {
        margin: 4px 0;
        font-size: small;
        opacity: 0.7;
      }

      p.preview {
        margin: 5px;
        white-space: pre-wrap;
      }
    }
  }
}
</style>
