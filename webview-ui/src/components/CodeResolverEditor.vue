<script setup lang="ts">
import { onMounted, ref, nextTick, computed } from "vue";
import {
  vscode,
  type UpdateCodeResolverTextDocumentActionCommand,
  type CodeResolverParams,
  type NameWithComment,
} from "@/utilities/vscode";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
import type { CodeItemDetail } from "@l-v-yonsama/multi-platform-database-drivers";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

type Props = {
  connectionSettingNames: string[];
  tableNameList: NameWithComment[];
  columnNameList: NameWithComment[];
  resolver: CodeResolverParams;
  scrollPos: number;
};
const props = defineProps<Props>();

const sectionHeight = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.cr-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 57, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
  const wrapper = document.querySelector(".cr-scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = props.scrollPos ?? 0;
  }
});

const keyword = ref(props.resolver.editor.keyword ?? "");
const visibleEditor = ref(props.resolver.editor.visible);
const connectionName = ref(props.resolver.editor.connectionName);
const connectionItems = props.connectionSettingNames.map((it) => ({ label: it, value: it }));
const editorItem = ref(
  props.resolver.editor.item ?? {
    title: "",
    description: "",
    resource: {
      column: {
        regex: false,
        pattern: "",
      },
    },
    details: [],
  }
);

const tableItems = props.tableNameList.map((it) => ({
  label: `${it.name}${it.comment ? " (" + it.comment + ")" : ""}`,
  value: it.name,
}));
tableItems.unshift({
  label: "-",
  value: "",
});
const columnItems = props.columnNameList.map((it) => ({
  label: `${it.name}${it.comment ? " (" + it.comment + ")" : ""}`,
  value: it.name,
}));

const items = ref(
  props.resolver.items.map((it, originalIndex) => ({
    ...it,
    originalIndex,
  }))
);

type ComputedItem = {
  title: string;
  description: string;
  resource: string;
  originalIndex: number;
  details: {
    code: string;
    label: string;
  }[];
};

const computedItems = computed((): ComputedItem[] => {
  const list: ComputedItem[] = [];

  items.value
    .filter((it) => {
      if (keyword.value.length === 0) {
        return true;
      }
      const k = keyword.value;
      if (
        it.title.indexOf(k) >= 0 ||
        (it.description && it.description.indexOf(k) >= 0) ||
        it.details.some((detail) => detail.code.indexOf(k) >= 0 || detail.label.indexOf(k) >= 0)
      ) {
        return true;
      }
      return false;
    })
    .forEach((item) => {
      let resource = "";
      if (item.resource?.table?.pattern) {
        const { regex, pattern } = item.resource.table;
        resource += `TABLE: ${regex ? "(REGEX)" : ""} ${pattern}`;
      }
      {
        const { regex, pattern } = item.resource.column;
        resource += `COLUMN: ${regex ? "(REGEX)" : ""} ${pattern}`;
      }
      list.push({
        title: item.title,
        description: item.description ?? "",
        originalIndex: item.originalIndex,
        resource,
        details: item.details,
      });
    });
  return list;
});

const createEditorParams = (): CodeResolverParams["editor"] => {
  return {
    ...props.resolver.editor,
    visible: visibleEditor.value,
    connectionName: connectionName.value,
    keyword: keyword.value,
    item: editorItem.value,
  };
};

const updateTextDocument = (
  values?: UpdateCodeResolverTextDocumentActionCommand["params"]["values"]
) => {
  const obj: CodeResolverParams = {
    editor: createEditorParams(),
    items: items.value,
  };
  const lastKnownScrollPosition = document.querySelector(".cr-scroll-wrapper")?.scrollTop ?? 0;
  const newText = JSON.stringify(obj, null, 2);
  vscode.postCommand({
    command: "updateCodeResolverTextDocument",
    params: {
      newText,
      values,
      scrollPos: lastKnownScrollPosition,
    },
  });
};

const handleChangeSpecifyResourceTable = (specify: boolean) => {
  if (specify) {
    editorItem.value.resource.table = {
      pattern: "",
      regex: false,
    };
  } else {
    editorItem.value.resource.table = undefined;
  }
  updateTextDocument();
};

const handleChangeRegexResource = (key: string, checked: boolean) => {
  if (key === "table") {
    editorItem.value.resource.table!.regex = checked;
  } else {
    editorItem.value.resource.column.regex = checked;
  }
  updateTextDocument();
};

const addDetail = () => {
  editorItem.value.details.push({
    code: "",
    label: "",
  });
  updateTextDocument();
};

const changeDetail = (detail: CodeItemDetail) => {
  if (
    (detail.code.length > 0 && detail.label.length > 0) ||
    (detail.code.length === 0 && detail.label.length === 0)
  ) {
    updateTextDocument();
  }
};

const deleteDetail = (index: number) => {
  editorItem.value.details.splice(index, 1);
  updateTextDocument();
};
</script>

<template>
  <section class="cr-root">
    <div v-if="visibleEditor" class="toolbar">
      <div class="tool-left">
        <label for="connectionName">Connection setting</label>
        <VsCodeDropdown
          id="connectionName"
          v-model="connectionName"
          :items="connectionItems"
          @change="updateTextDocument({ name: 'change', detail: 'connectionName' })"
        />
      </div>
      <div class="tool-right">
        <VsCodeButton
          @click="updateTextDocument({ name: 'cancel' })"
          appearance="secondary"
          title="Cancel"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton @click="updateTextDocument({ name: 'save-code-item' })" title="Save"
          ><fa icon="check" />Ok</VsCodeButton
        >
      </div>
    </div>
    <div v-else class="toolbar">
      <div class="tool-left">
        <label for="keyword"> <fa icon="search" style="margin-right: 3px" />Search </label>
        <VsCodeTextField
          id="keyword"
          v-model="keyword"
          :maxlength="128"
          :change-on-mouseout="true"
          title="keyword"
          placeholder="Enter a keyword"
          @change="updateTextDocument()"
        >
        </VsCodeTextField>
      </div>
      <div class="tool-right">
        <VsCodeButton @click="updateTextDocument({ name: 'add-code-item' })" title="Add code item"
          ><fa icon="plus" />Add code item</VsCodeButton
        >
      </div>
    </div>
    <div class="cr-scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div v-if="visibleEditor" class="editor">
        <div class="code-name">
          <label :for="`codeName`">Code name</label>
          <VsCodeTextField
            :id="`codeName`"
            v-model="editorItem.title"
            :maxlength="128"
            :transparent="true"
            :required="true"
            :change-on-mouseout="true"
            style="flex-grow: 1"
            @change="updateTextDocument()"
          />
        </div>
        <div class="description">
          <label :for="`description`">Description</label>
          <VsCodeTextField
            :id="`description`"
            v-model="editorItem.description"
            :maxlength="256"
            :transparent="true"
            :change-on-mouseout="true"
            style="flex-grow: 1"
            @change="updateTextDocument()"
          />
        </div>
        <fieldset class="resource">
          <legend>Applicable Resources</legend>
          <table>
            <tbody>
              <tr>
                <td style="width: 130px">
                  <vscode-checkbox
                    :checked="editorItem.resource.table !== undefined"
                    @change="($e:any) => handleChangeSpecifyResourceTable($e.target.checked)"
                    style="margin-right: auto"
                    >Specify table</vscode-checkbox
                  >
                </td>
                <td style="width: 170px">
                  <template v-if="editorItem.resource.table !== undefined">
                    <vscode-checkbox
                      :checked="editorItem.resource.table.regex"
                      @change="($e:any) => handleChangeRegexResource('table', $e.target.checked)"
                      >Regular expression</vscode-checkbox
                    >
                  </template>
                </td>
                <td>
                  <template v-if="editorItem.resource.table !== undefined">
                    <VsCodeDropdown
                      v-if="!editorItem.resource.table.regex"
                      :id="`resourceTable`"
                      v-model="editorItem.resource.table.pattern"
                      :items="tableItems"
                      :transparent="true"
                      :required="true"
                      style="z-index: 11"
                      @change="updateTextDocument()"
                    ></VsCodeDropdown>

                    <VsCodeTextField
                      v-if="editorItem.resource.table.regex"
                      :id="`resourceTable`"
                      v-model="editorItem.resource.table.pattern"
                      :maxlength="256"
                      :transparent="true"
                      :required="true"
                      :change-on-mouseout="true"
                      @change="updateTextDocument()"
                    ></VsCodeTextField>
                  </template>
                </td>
              </tr>
              <tr>
                <td>
                  <label :for="`resourceColumn`">Column</label>
                </td>
                <td>
                  <vscode-checkbox
                    :checked="editorItem.resource.column.regex"
                    @change="($e:any) => handleChangeRegexResource(  'column', $e.target.checked)"
                    >Regular expression</vscode-checkbox
                  >
                </td>
                <td>
                  <VsCodeDropdown
                    v-if="!editorItem.resource.column.regex"
                    :id="`resourceColumn`"
                    v-model="editorItem.resource.column.pattern"
                    :items="columnItems"
                    :transparent="true"
                    :required="true"
                    @change="updateTextDocument()"
                  ></VsCodeDropdown>

                  <VsCodeTextField
                    v-if="editorItem.resource.column.regex"
                    :id="`resourceColumn`"
                    v-model="editorItem.resource.column.pattern"
                    :maxlength="256"
                    :transparent="true"
                    :required="true"
                    :change-on-mouseout="true"
                    @change="updateTextDocument()"
                  ></VsCodeTextField>
                </td>
              </tr>
            </tbody>
          </table>
        </fieldset>
        <fieldset class="details">
          <legend>
            <span>Details</span>

            <VsCodeButton
              @click="addDetail"
              title="Add detail"
              appearance="secondary"
              style="margin-left: 2px"
              ><fa icon="plus" />Add detail</VsCodeButton
            >
          </legend>
          <table v-if="editorItem.details.length > 0">
            <thead>
              <tr>
                <th class="no">No</th>
                <th class="code">Code</th>
                <th class="label">Label</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(detail, idx2) of editorItem.details">
                <td class="no" style="text-align: right">{{ idx2 + 1 }}</td>
                <td class="code">
                  <VsCodeTextField
                    v-model="editorItem.details[idx2].code"
                    :maxlength="256"
                    :transparent="true"
                    :required="true"
                    :change-on-mouseout="true"
                    @change="changeDetail(detail)"
                  ></VsCodeTextField>
                </td>
                <td class="label">
                  <VsCodeTextField
                    v-model="editorItem.details[idx2].label"
                    :maxlength="256"
                    :transparent="true"
                    :required="true"
                    :change-on-mouseout="true"
                    style="flex-grow: 1"
                    @change="changeDetail(detail)"
                  ></VsCodeTextField>
                </td>
                <td style="width: 85px">
                  <VsCodeButton
                    @click="deleteDetail(idx2)"
                    title="Delete detail"
                    appearance="secondary"
                    style="margin-left: 2px"
                    ><fa icon="trash" />Delete</VsCodeButton
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </fieldset>
      </div>
      <section v-else class="items">
        <table>
          <thead>
            <tr>
              <th rowspan="2" class="code-name">Code name</th>
              <th rowspan="2" class="w150">Applicable Resources</th>
              <th colspan="2">Code detail</th>
              <th rowspan="2">Description</th>
            </tr>
            <tr>
              <th class="w100">Value</th>
              <th class="w150">Label</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(item, idx) of computedItems" :key="idx">
              <template v-if="item.details.length === 0">
                <tr>
                  <td class="code-name">
                    <p>{{ item.title }}</p>
                    <div class="controller">
                      <VsCodeButton
                        @click="
                          updateTextDocument({ name: 'edit-code-item', detail: item.originalIndex })
                        "
                        title="Edit code"
                        appearance="secondary"
                        ><fa icon="pencil" />Edit</VsCodeButton
                      >
                      <VsCodeButton
                        @click="
                          updateTextDocument({
                            name: 'duplicate-code-item',
                            detail: item.originalIndex,
                          })
                        "
                        title="Duplicate code"
                        appearance="secondary"
                        ><fa icon="plus" />Duplicate</VsCodeButton
                      >
                      <VsCodeButton
                        @click="
                          updateTextDocument({
                            name: 'delete-code-item',
                            detail: item.originalIndex,
                          })
                        "
                        title="Delete code"
                        appearance="secondary"
                        ><fa icon="trash" />Delete</VsCodeButton
                      >
                    </div>
                  </td>
                  <td class="w150">
                    {{ item.resource }}
                  </td>
                  <td class="w100">-</td>
                  <td class="w150">-</td>
                  <td>{{ item.description }}</td>
                </tr>
              </template>
              <template v-else>
                <tr v-for="(detail, idx2) of item.details" :key="`${idx}-${idx2}`">
                  <td v-if="idx2 === 0" :rowspan="item.details.length" class="code-name">
                    <p>{{ item.title }}</p>
                    <div class="controller">
                      <VsCodeButton
                        @click="
                          updateTextDocument({ name: 'edit-code-item', detail: item.originalIndex })
                        "
                        title="Edit code"
                        appearance="secondary"
                        ><fa icon="pencil" />Edit</VsCodeButton
                      >
                      <VsCodeButton
                        @click="
                          updateTextDocument({
                            name: 'duplicate-code-item',
                            detail: item.originalIndex,
                          })
                        "
                        title="Duplicate code"
                        appearance="secondary"
                        ><fa icon="plus" />Duplicate</VsCodeButton
                      >
                      <VsCodeButton
                        @click="
                          updateTextDocument({
                            name: 'delete-code-item',
                            detail: item.originalIndex,
                          })
                        "
                        title="Delete code"
                        appearance="secondary"
                        ><fa icon="trash" />Delete</VsCodeButton
                      >
                    </div>
                  </td>
                  <td v-if="idx2 === 0" :rowspan="item.details.length" class="w150">
                    {{ item.resource }}
                  </td>
                  <td class="w100">{{ detail.code }}</td>
                  <td class="w150">{{ detail.label }}</td>
                  <td v-if="idx2 === 0" :rowspan="item.details.length">{{ item.description }}</td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </section>
    </div>
  </section>
</template>

<style scoped>
.cr-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
div.editor vscode-dropdown {
  z-index: 5;
}
div.editor {
  padding: 5px;
}
div.description {
  display: flex;
  flex-direction: row;
  column-gap: 5px;
}
section.item {
  display: flex;
  flex-direction: column;
  row-gap: 10px;
  margin-bottom: 25px;
}
section.detail {
  margin-top: 25px;
}

div.code-name {
  display: flex;
  align-items: center;
  column-gap: 5px;
}
fieldset {
  display: flex;
  align-items: center;
  width: calc(100% - 55px);
  margin-left: 20px;
  column-gap: 5px;
}
legend {
  width: -webkit-fill-available;
}
.details fieldset legend > span {
  margin-right: auto;
}
fieldset.resource {
  flex-direction: column;
  margin-top: 3px;
  margin-bottom: 3px;
}
fieldset.resource > table {
  width: 100%;
}
fieldset.resource > table vscode-dropdown,
fieldset.resource > table vscode-text-field {
  width: 100%;
}
.details table {
  width: 100%;
}
.details table vscode-text-field {
  width: 100%;
}
label {
  margin-right: 4px;
}
section.items {
  padding: 5px;
  flex-grow: 1;
  display: flex;
}
.cr-scroll-wrapper {
  overflow: auto;
  flex-grow: 1;
}
section.items table {
  border-collapse: collapse;
  width: 100%;
}
section.items table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: var(--vscode-editorPane-background);
}
section.items table th {
  height: 20px;
  padding: 2px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  position: relative;
}

td.code-name > .controller {
  display: flex;
  justify-content: space-between;
  visibility: hidden;
}
td.code-name:hover > .controller {
  visibility: visible;
}

section.items thead th.code-name,
section.items tbody td.code-name {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 255px;
  width: 255px;
  background-color: var(--vscode-editorPane-background);
}

section.items table th,
section.items table td {
  border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
  padding: 2px;
}

section.items span.label {
  display: inline-block;
  vertical-align: middle;
  height: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.w100 {
  width: 100px;
  max-width: 100px;
}
.w150 {
  width: 150px;
  max-width: 150px;
}
</style>
