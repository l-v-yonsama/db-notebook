<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import { vscode, type CountRecordViewEventData } from "@/utilities/vscode";
import type { ResultSetData } from "@l-v-yonsama/rdh";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import VsCodeRadioGroupVue from "../base/VsCodeRadioGroup.vue";
import RDHViewer from "../RDHViewer.vue";

const sectionWidth = ref(300);
const sectionHeight = ref(300);
const mode = ref("setting" as CountRecordViewEventData["value"]["refresh"]["mode"]);
const rdh = ref(undefined as ResultSetData | undefined);

type TableItem = {
  name: string;
  comment: string;
  selectedString: "Yes" | "No";
};

const countingTargetItems: DropdownItem[] = [
  {
    label: "Yes",
    value: "Yes",
  },
  {
    label: "No",
    value: "No",
  },
];

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 76, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = sectionWrapper.clientWidth - 14;
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const allTableItems = ref([] as TableItem[]);

const refresh = async (v: CountRecordViewEventData["value"]["refresh"]) => {
  if (v === undefined) {
    return;
  }
  const { schemaRes, selectedTableNames } = v;

  mode.value = v.mode;
  rdh.value = undefined;
  allTableItems.value.splice(0, allTableItems.value.length);

  await nextTick();
  rdh.value = v.rdh;

  schemaRes.children.forEach((table) => {
    allTableItems.value.push({
      name: table.name,
      comment: table.comment ?? "",
      selectedString: selectedTableNames.includes(table.name) ? "Yes" : "No",
    });
  });
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const output = (): void => {
  vscode.postCommand({
    command: "output",
    params: {
      tabId: "",
      fileType: "excel",
      displayOnlyChanged: false,
    },
  });
};

const doCount = () => {
  vscode.postCommand({
    command: "countAllTables",
    params: {
      selectedTableNames: allTableItems.value
        .filter((it) => it.selectedString === "Yes")
        .map((it) => it.name),
    },
  });
};

const recieveMessage = (data: CountRecordViewEventData) => {
  const { command, value } = data;
  switch (command) {
    case "refresh":
      if (value.refresh === undefined) {
        return;
      }
      refresh(value.refresh);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <div class="toolbar">
      <div class="tool-left"></div>
      <div class="tool-right">
        <VsCodeButton
          :disabled="mode === 'running'"
          @click="cancel"
          appearance="secondary"
          title="Cancel"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton
          v-if="rdh && mode !== 'setting'"
          :disabled="mode === 'running'"
          @click="output"
          appearance="secondary"
          title="Output as Excel"
          ><fa icon="file-excel" />Output as Excel</VsCodeButton
        >
        <VsCodeButton :disabled="mode === 'running'" title="Count selected tables" @click="doCount"
          ><fa icon="circle-play" />Count selected tables</VsCodeButton
        >
      </div>
    </div>
    <section class="content">
      <div
        v-if="mode === 'setting'"
        class="scroll-wrapper"
        :style="{ height: `${sectionHeight}px` }"
      >
        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th>Comment</th>
              <th>Counting target</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(item, idx) of allTableItems" :key="idx">
              <tr>
                <td>{{ item.name }}</td>
                <td>{{ item.comment }}</td>
                <td>
                  <VsCodeRadioGroupVue
                    class="switch"
                    v-model="item.selectedString"
                    :items="countingTargetItems"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <RDHViewer
        v-if="rdh && mode !== 'setting'"
        :rdh="rdh"
        :width="sectionWidth"
        :height="sectionHeight"
      />
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

table {
  border-collapse: collapse;
  width: 100%;

  th {
    height: 20px;
    padding: 2px;
  }
  th,
  td {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    max-width: 180px;
    vertical-align: middle;
    text-align: center;
    border: calc(var(--border-width) * 1px) solid var(--dropdown-border);

    .switch {
      align-items: center;
    }
  }
}

.control {
  width: 110px;
  max-width: 110px;
}
div.scroll-wrapper {
  overflow: auto;
}
</style>
