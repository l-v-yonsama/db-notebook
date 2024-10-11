<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  UpdateTextDocumentActionCommand,
  ViewConditionPanelEventData,
  ViewConditionParams,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import RDHViewer from "./RDHViewer.vue";
import TopLevelConditionVue from "./TopLevelCondition.vue";

import { GeneralColumnType } from "@l-v-yonsama/rdh";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

const sectionHeight = ref(300);
const sectionWidth = ref(300);
const rdhForUpdate = ref(null as any);
const visibleSettingsMode = ref(true);
const supportEditMode = ref(false);
const numOfRowsLabel = ref('Current rows');

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector(".view-conditional-root");
  if (sectionWrapper?.clientHeight) {
    // Don't make it any less because the side-scrolling bar will disappear.
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 50, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = Math.max(sectionWrapper.clientWidth - 14, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const rdhViewerRef = ref<InstanceType<typeof RDHViewer>>();
const setRdhViewerRef = (el: any) => {
  rdhViewerRef.value = el;
};

const specifyCondition = ref(false);
const previewSql = ref("");

const limit = ref("0");
const numOfRows = ref(0);
let limitMax = 100000;
const visibleCondition = ref(true);
const tableNameWithComment = ref("");

const parseDynamoAttrType = (typeString: string): GeneralColumnType => {
  if (typeString == null || typeString === '') {
    return GeneralColumnType.UNKNOWN;
  }
  if ('S' === typeString) {
    return GeneralColumnType.TEXT;
  } else if ('N' === typeString) {
    return GeneralColumnType.NUMERIC;
  } else if ('B' === typeString) {
    return GeneralColumnType.BINARY;
  } else if (
    'SS' === typeString ||
    'NS' === typeString ||
    'BS' === typeString
  ) {
    return GeneralColumnType.SET;
  } else if ('M' === typeString) {
    return GeneralColumnType.JSON;
  } else if ('L' === typeString) {
    return GeneralColumnType.ARRAY;
  } else if ('NULL' === typeString) {
    return GeneralColumnType.NULL;
  } else if ('BOOL' === typeString) {
    return GeneralColumnType.BOOLEAN;
  }
  return GeneralColumnType.UNKNOWN;
};


const initialize = (v: ViewConditionPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }

  limit.value = (v.limit ?? 100) + "";
  numOfRows.value = v.numOfRows;
  limitMax = Math.max(100000, v.numOfRows);
  previewSql.value = v.previewSql;
  supportEditMode.value = v.supportEditMode;
  numOfRowsLabel.value = v.numOfRowsLabel;
  visibleSettingsMode.value = true;
  let cols: DropdownItem[] = [];

  if (v.tableRes.resourceType === 'Table') {
    if (v.tableRes.comment) {
      tableNameWithComment.value = `${v.tableRes.name} (${v.tableRes.comment})`;
    } else {
      tableNameWithComment.value = v.tableRes.name;
    }

    cols = v.tableRes.children.map((it) => {
      let label = it.name;
      if (it.comment) {
        label += " " + it.comment;
      }

      return {
        label,
        value: it.name,
        meta: {
          colType: (it as any).colType,
        },
      };
    }) as DropdownItem[];
  } else {
    tableNameWithComment.value = v.tableRes.name;
    cols = v.tableRes.children.map((it) => {
      let label = it.name;
      if (it.comment) {
        label += " " + it.comment;
      }

      return {
        label,
        value: it.name,
        meta: {
          colType: parseDynamoAttrType((it as any).attrType),
        },
      };
    }) as DropdownItem[];
  }
  cols.unshift({
    label: "-",
    value: "",
    meta: {},
  });
  columnItems.value.splice(0, columnItems.value.length);
  cols.forEach((it) => columnItems.value.push(it));
};

const columnItems = ref([] as DropdownItem[]);

const editorItem = ref({
  conditions: {
    all: [
      {
        fact: "",
        operator: "",
        value: "",
        params: {
          valType: "static",
          valColumn: "",
        },
      },
    ],
  },
});

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};
const handleSpecifyConditionOnChange = (newVal: boolean) => {
  specifyCondition.value = newVal;

  ok(false, true);
};
const updateTextDocument = (values?: UpdateTextDocumentActionCommand["params"]["values"]) => {
  visibleCondition.value = false;
  nextTick(() => {
    visibleCondition.value = true;
    ok(false, true);
  });
};

const ok = (editable: boolean, preview: boolean) => {
  const params: ViewConditionParams = {
    conditions: JSON.parse(JSON.stringify(editorItem.value.conditions)),
    specfyCondition: specifyCondition.value,
    limit: limit.value === "" ? 100 : Number(limit.value),
    editable,
    preview,
  };
  vscode.postCommand({
    command: "ok",
    params,
  });
};

const saveValues = () => {
  const result = rdhViewerRef.value?.save();
  if (result && result.ok) {
    vscode.postCommand({
      command: "saveValues",
      params: {
        ...result,
      },
    });
  } else {
    vscode.postCommand({
      command: "showError",
      params: {
        message: result.message,
      },
    });
  }
};

const setPreviewSql = (sql: string): void => {
  previewSql.value = sql;
};

const recieveMessage = (data: ViewConditionPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
    case "set-preview-sql":
      if (value.setPreviewSql === undefined) {
        return;
      }
      setPreviewSql(value.setPreviewSql.previewSql);
      break;
    case "set-rdh-for-update":
      rdhForUpdate.value = value.rdhForUpdate;
      visibleSettingsMode.value = false;
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="view-conditional-root">
    <div class="toolbar">
      <div class="tool-left">
        <label for="tableName">Table:</label>
        <span id="tableName">{{ tableNameWithComment }}</span>
        <label for="numOfRows">{{ numOfRowsLabel }}:</label>
        <span id="numOfRows">{{ numOfRows }}</span>
        <label v-if="visibleSettingsMode" for="limit">Limit:</label>
        <VsCodeTextField id="limit" v-if="visibleSettingsMode" v-model="limit" :min="0" :max="limitMax"
          style="width: 100px" type="number" title="number of rows returned" placeholder="number of rows returned"
          @change="updateTextDocument()">
        </VsCodeTextField>
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel" style="margin-right: 5px">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton v-if="visibleSettingsMode && supportEditMode" @click="ok(true, false)" appearance="secondary"
          title="Retlieve in editable mode" style="margin-right: 5px">
          <fa icon="pencil" />Retlieve in editable mode
        </VsCodeButton>
        <VsCodeButton v-if="visibleSettingsMode" @click="ok(false, false)" title="Retlieve">
          <fa icon="check" />Retlieve
        </VsCodeButton>
        <VsCodeButton v-if="!visibleSettingsMode" @click="saveValues()" title="Save changes to table">
          <fa icon="save" />Save changes to table
        </VsCodeButton>
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div v-if="visibleSettingsMode" class="settings">
        <div class="editor">
          <fieldset class="conditions">
            <legend>
              <span style="margin-right: 30px">Conditions</span>

              <vscode-checkbox :checked="specifyCondition === true"
                @change="($e: any) => handleSpecifyConditionOnChange($e.target.checked)"
                style="margin-right: auto">Specify</vscode-checkbox>
            </legend>
            <TopLevelConditionVue v-if="visibleCondition && specifyCondition" v-model="editorItem.conditions"
              :columnItems="columnItems" :rule-base-mode="false" :lv="0" @change="updateTextDocument()" />
          </fieldset>
        </div>
        <fieldset class="conditions">
          <legend>Preview</legend>
          <p class="preview" v-text="previewSql"></p>
        </fieldset>
      </div>
      <div v-else class="spread">
        <RDHViewer :rdh="rdhForUpdate" :width="sectionWidth" :height="sectionHeight" :ref="setRdhViewerRef" />
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
section.view-conditional-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  &>div {
    margin: 5px;

    &.toolbar {
      margin-bottom: 20px !important;

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
        margin-top: 15px;
      }

      p.preview {
        margin: 5px;
        white-space: pre-wrap;
      }
    }
  }
}
</style>
