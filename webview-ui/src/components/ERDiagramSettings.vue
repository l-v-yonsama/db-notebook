<script setup lang="ts">
import {
  vscode,
  type ActionCommand,
  type ERDiagramSettingsPanelEventData,
} from "@/utilities/vscode";
import type {
  DbTable,
  ForeignKeyConstraintDetail,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

const sectionHeight = ref(300);

type TableItem = {
  name: string;
  comment: string;
  selected: boolean;
  referencedFrom: string[];
  referenceTo: string[];
  isAll: boolean;
  isKeys: boolean;
  isNotNull: boolean;
  columns: string[];
  fkColumns: string[];
};

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 76, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

function getReferenceTableNames(references?: {
  [columnName: string]: ForeignKeyConstraintDetail;
}): string[] {
  if (references) {
    return Object.values(references).map((v) => v.tableName);
  }
  return [];
}

const title = ref("");
const allTableItems = ref([] as TableItem[]);
let tables: DbTable[] = [];

const initialize = (v: ERDiagramSettingsPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  tables = v.params.tables as DbTable[];
  title.value = v.params.title;

  v.params.tables.forEach((table) => {
    allTableItems.value.push({
      name: table.name,
      comment: table.comment ?? "",
      selected: v.params.selectedTable?.name === table.name,
      referencedFrom: getReferenceTableNames(table.foreignKeys?.referencedFrom),
      referenceTo: getReferenceTableNames(table.foreignKeys?.referenceTo),
      isAll: true,
      isKeys: true,
      isNotNull: true,
      columns: [],
      fkColumns: Object.keys(table.foreignKeys?.referenceTo ?? {}),
    });
  });

  allTableItems.value.forEach((tableItem) => {
    resetAll(tableItem, true);
  });
};

const zeroSelection = computed(() => allTableItems.value.every((it) => !it.selected));

function resetAll(tableItem: TableItem, checked: boolean) {
  tableItem.columns.splice(0, tableItem.columns.length);
  if (checked) {
    tableItem.isAll = true;
    tableItem.isKeys = true;
    tableItem.isNotNull = true;
    tableItem.columns.push(
      ...(tables.find((it) => it.name === tableItem.name)?.children.map((it) => it.name) ?? [])
    );
    return;
  }
  tableItem.isAll = false;
  tableItem.isKeys = false;
  tableItem.isNotNull = false;
}

function resetKeys(tableItem: TableItem, checked: boolean) {
  tableItem.isKeys = checked;
  tableItem.columns.splice(0, tableItem.columns.length);

  tableItem.columns.push(
    ...(tables
      .find((it) => it.name === tableItem.name)
      ?.children.filter((it) => {
        const dispByKey =
          tableItem.isKeys &&
          (it.primaryKey || it.uniqKey || tableItem.fkColumns.includes(it.name));
        const dispByNN = tableItem.isNotNull && !it.nullable;
        return dispByKey || dispByNN;
      })
      .map((it) => it.name) ?? [])
  );
}

function resetNotNull(tableItem: TableItem, checked: boolean) {
  tableItem.isNotNull = checked;
  tableItem.columns.splice(0, tableItem.columns.length);

  tableItem.columns.push(
    ...(tables
      .find((it) => it.name === tableItem.name)
      ?.children.filter((it) => {
        const dispByKey =
          tableItem.isKeys &&
          (it.primaryKey || it.uniqKey || tableItem.fkColumns.includes(it.name));
        const dispByNN = tableItem.isNotNull && !it.nullable;
        return dispByKey || dispByNN;
      })
      .map((it) => it.name) ?? [])
  );
}

function selectTable(tableItem: TableItem) {
  tableItem.selected = true;
  resetAll(tableItem, true);
}

function displaySelectedColumns(columnNames: string[]): string {
  if (columnNames.length === 0) {
    return "No columns. (Display only table box)";
  }
  return columnNames.join(",");
}

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const action = (command: ActionCommand["command"]): void => {
  const items = allTableItems.value
    .filter((it) => it.selected)
    .map((it) => ({
      tableName: it.name,
      columnNames: [...it.columns],
    }));

  if (command === "writeToClipboard") {
    vscode.postCommand({
      command,
      params: {
        tabId: "",
        fileType: "markdown",
        options: {
          title: title.value,
          items,
        },
      },
    });
    return;
  }

  vscode.postCommand({
    command: "createERDiagram",
    params: {
      title: title.value,
      items,
    },
  });
};

const recieveMessage = (data: ERDiagramSettingsPanelEventData) => {
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
    <div class="toolbar">
      <div class="tool-left">
        <label for="title">Title:</label>
        <VsCodeTextField id="title" v-model="title" style="width: calc(100% - 45px)" />
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton :disabled="zeroSelection" @click="action('writeToClipboard')" appearance="secondary"
          title="Write ER diagram to clipboard">
          <fa icon="clipboard" />Copy to clipboard
        </VsCodeButton>
        <VsCodeButton :disabled="zeroSelection" @click="action('createERDiagram')"
          title="Create ER diagram in a new Notebook">
          <fa icon="plus" />Create in a new Notebook
        </VsCodeButton>
      </div>
    </div>
    <section class="content">
      <table>
        <thead>
          <tr>
            <th>All tables</th>
            <th>Selected</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
                <table>
                  <thead>
                    <tr class="top">
                      <th>Table</th>
                      <th>Comment</th>
                      <th rowspan="2">Control</th>
                    </tr>
                    <tr class="bottom">
                      <th>referenced from</th>
                      <th>reference to</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="(item, idx) of allTableItems" :key="idx">
                      <tr class="top" v-if="!item.selected">
                        <td>{{ item.name }}</td>
                        <td>{{ item.comment }}</td>
                        <td rowspan="2">
                          <VsCodeButton :disabled="item.selected" @click="selectTable(item)">Select</VsCodeButton>
                        </td>
                      </tr>
                      <tr class="bottom" v-if="!item.selected">
                        <td>{{ item.referencedFrom.join(",") }}&nbsp;</td>
                        <td>{{ item.referenceTo.join(",") }}&nbsp;</td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </td>
            <td class="border-left">
              <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
                <table>
                  <thead>
                    <tr class="top">
                      <th>Table</th>
                      <th>Comment</th>
                      <th>All</th>
                      <th>Keys</th>
                      <th>NotNull</th>
                      <th>Control</th>
                    </tr>
                    <tr class="bottom">
                      <th colspan="6">Columns</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="(item, idx) of allTableItems" :key="idx">
                      <tr class="top" v-if="item.selected">
                        <td>{{ item.name }}</td>
                        <td>{{ item.comment }}</td>
                        <td>
                          <input type="checkbox" :checked="item.isAll" @change="resetAll(item, !item.isAll)" />
                        </td>
                        <td>
                          <input type="checkbox" :disabled="item.isAll" :checked="item.isKeys"
                            @change="resetKeys(item, !item.isKeys)" />
                        </td>
                        <td>
                          <input type="checkbox" :disabled="item.isAll" :checked="item.isNotNull"
                            @change="resetNotNull(item, !item.isNotNull)" />
                        </td>
                        <td>
                          <VsCodeButton @click="item.selected = false">Unselect</VsCodeButton>
                        </td>
                      </tr>
                      <tr class="bottom" v-if="item.selected">
                        <td style="max-width: 400px">
                          {{ displaySelectedColumns(item.columns) }}&nbsp;
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
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

table {
  border-collapse: collapse;
  width: 100%;
}

tr.top {
  border-top: calc(var(--border-width) * 1px) solid var(--dropdown-border);
}

tr.bottom {
  border-bottom: calc(var(--border-width) * 1px) solid var(--dropdown-border);
}

td {
  text-align: center;
  vertical-align: top;
}

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
}

.border-left {
  border-left: calc(var(--border-width) * 1px) solid var(--dropdown-border);
}

.border-right {
  border-right: calc(var(--border-width) * 1px) solid var(--dropdown-border);
}

.control {
  width: 110px;
  max-width: 110px;
}

div.scroll-wrapper {
  overflow: auto;
}
</style>
