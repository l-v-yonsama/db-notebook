<script setup lang="ts">
import { defineExpose, nextTick, ref, onMounted } from "vue";
import { vscode } from "@/utilities/vscode";
import type { UpdateTextDocumentActionCommand, ViewConditionParams } from "@/utilities/vscode";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeButton from "./base/VsCodeButton.vue";

import type { DropdownItem } from "@/types/Components";
import TopLevelConditionVue from "./TopLevelCondition.vue";
import type { DbTable } from "@l-v-yonsama/multi-platform-database-drivers";
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeCheckbox());

type Props = {
  tableRes: DbTable;
  numOfRows: number;
  limit: number;
  previewSql: string;
};

const props = defineProps<Props>();

const sectionHeight = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector(".view-conditional-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 35, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const specifyCondition = ref(false);
const previewSql = ref(props.previewSql);

const limit = ref((props.limit ?? 0) + "");
const limitMax = Math.min(100000, props.numOfRows);
const visibleCondition = ref(true);

const columnItems = ref(
  props.tableRes.children.map((it) => {
    let label = it.name;
    if (it.comment) {
      label += " " + it.comment;
    }

    return {
      label,
      value: it.name,
      meta: {
        colType: it.colType,
      },
    };
  }) as DropdownItem[]
);
columnItems.value.unshift({
  label: "-",
  value: "",
  meta: {},
});

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
  console.log("called handleSpecifyConditionOnChange:", newVal);
  specifyCondition.value = newVal;
  ok(false, true);
};
const updateTextDocument = (values?: UpdateTextDocumentActionCommand["params"]["values"]) => {
  console.log("called updateTextDocument:" + values);
  console.log("editorItem", JSON.stringify(editorItem.value));
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
    limit: Number(limit.value),
    editable,
    preview,
  };
  vscode.postCommand({
    command: "ok",
    params,
  });
};

const setPreviewSql = (sql: string): void => {
  console.log(" called setpreviewll", sql);
  previewSql.value = sql;
};

defineExpose({
  setPreviewSql,
});
</script>

<template>
  <section class="view-conditional-root">
    <div class="toolbar">
      <div class="tool-left">
        <label for="tableName">Table:</label>
        <span id="tableName"
          >{{ props.tableRes.name
          }}{{
            (props.tableRes.comment ?? "").length > 0 ? ` (${props.tableRes.comment})` : ""
          }}</span
        >
        <label for="numOfRows">Current rows:</label>
        <span id="numOfRows">{{ props.numOfRows }}</span>
        <label for="limit">Limit:</label>
        <VsCodeTextField
          id="limit"
          v-model="limit"
          :min="0"
          :max="limitMax"
          style="width: 100px"
          type="number"
          title="number of rows returned"
          placeholder="number of rows returned"
        >
        </VsCodeTextField>
      </div>
      <div class="tool-right">
        <VsCodeButton
          @click="cancel"
          appearance="secondary"
          title="Cancel"
          style="margin-right: 5px"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton
          @click="ok(true, false)"
          appearance="secondary"
          title="Retlieve in editable mode"
          style="margin-right: 5px"
          ><fa icon="pencil" />Retlieve in editable mode</VsCodeButton
        >
        <VsCodeButton @click="ok(false, false)" title="Retlieve"
          ><fa icon="check" />Retlieve</VsCodeButton
        >
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="editor">
        <fieldset class="conditions">
          <legend>
            <span style="margin-right: 30px">Conditions</span>

            <vscode-checkbox
              :checked="specifyCondition === true"
              @change="($e:any) => handleSpecifyConditionOnChange($e.target.checked)"
              style="margin-right: auto"
              >Specify</vscode-checkbox
            >
          </legend>
          <TopLevelConditionVue
            v-if="visibleCondition && specifyCondition"
            v-model="editorItem.conditions"
            :columnItems="columnItems"
            :rule-base-mode="false"
            :lv="0"
            @change="updateTextDocument()"
          />
        </fieldset>
      </div>
      <fieldset class="conditions">
        <legend>Preview</legend>
        <p class="preview" v-text="previewSql"></p>
      </fieldset>
    </div>
  </section>
</template>

<style scoped>
section.view-conditional-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
section.view-conditional-root > div {
  margin: 5px;
}
div.toolbar {
  margin-bottom: 20px !important;
}

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

.scroll-wrapper {
  overflow: auto;
}
table {
  width: 100%;
}
.ctl {
  width: 80px;
  max-width: 80px;
}
.col {
  width: 320px;
}

.ope {
  width: 122px;
  max-width: 122px;
  text-align: center;
}
.eg {
  width: 122px;
  max-width: 122px;
  text-align: center;
}

fieldset.conditions {
  margin-top: 15px;
}
p.preview {
  margin: 5px;
  white-space: pre-wrap;
}
</style>