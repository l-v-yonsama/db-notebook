<script setup lang="ts">
import { onMounted, ref, nextTick, computed } from "vue";
import {
  vscode,
  type UpdateCodeResolverTextDocumentActionCommand,
  type CodeResolverParams,
  type CodeResolverEditorEventData,
} from "@/utilities/vscode";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
import Paragraph from "./base/Paragraph.vue";

import type { DropdownItem } from "@/types/Components";
import type { CodeItem, CodeItemDetail } from "@l-v-yonsama/multi-platform-database-drivers";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

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
});

let resolver: CodeResolverParams;
const keyword = ref("");
const visibleEditor = ref(false);
const connectionName = ref("");
const connectionItems: DropdownItem[] = [];
const editorItem = ref({
  title: "",
  description: "",
  resource: {
    column: {
      regex: false,
      pattern: "",
    },
  },
  details: [],
} as CodeItem);
const tableItems = [] as DropdownItem[];
const columnItems = [] as DropdownItem[];
const items = ref([] as (CodeItem & { originalIndex: number })[]);

const initialize = (v: CodeResolverEditorEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  resolver = v.resolver;
  keyword.value = v.resolver.editor.keyword ?? "";
  connectionName.value = v.resolver.editor.connectionName;
  connectionItems.splice(0, connectionItems.length);
  connectionItems.push({
    label: "-",
    value: "",
  });
  v.connectionSettingNames.map((it) => {
    connectionItems.push({ label: it, value: it });
  });

  tableItems.splice(0, tableItems.length);
  v.tableNameList.forEach((it) =>
    tableItems.push({
      label: `${it.name}${it.comment ? " (" + it.comment + ")" : ""}`,
      value: it.name,
    })
  );
  tableItems.unshift({
    label: "-",
    value: "",
  });

  columnItems.splice(0, columnItems.length);
  v.columnNameList.forEach((it) =>
    columnItems.push({
      label: `${it.name}${it.comment ? " (" + it.comment + ")" : ""}`,
      value: it.name,
    })
  );

  const wrapper = document.querySelector(".cr-scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = v.scrollPos ?? 0;
  }
  items.value.splice(0, items.value.length);
  v.resolver.items.forEach((it, originalIndex) =>
    items.value.push({
      ...it,
      originalIndex,
    })
  );

  Object.assign(editorItem.value, v.resolver.editor.item);
  visibleEditor.value = v.resolver.editor.visible;
};

type ComputedItem = {
  title: string;
  description: string;
  resource: {
    table?: {
      regex: boolean;
      pattern: string;
    };
    column: {
      regex: boolean;
      pattern: string;
    };
  };
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
      const k = (keyword.value ?? "").toLocaleLowerCase();
      if (
        it.title.toLocaleLowerCase().indexOf(k) >= 0 ||
        (it.resource?.table?.pattern &&
          it.resource.table.pattern.toLocaleLowerCase().indexOf(k) >= 0) ||
        it.resource.column.pattern.toLocaleLowerCase().indexOf(k) >= 0 ||
        (it.description && it.description.toLocaleLowerCase().indexOf(k) >= 0) ||
        it.details.some(
          (detail) =>
            detail.code.toLocaleLowerCase().indexOf(k) >= 0 ||
            detail.label.toLocaleLowerCase().indexOf(k) >= 0
        )
      ) {
        return true;
      }
      return false;
    })
    .forEach((item) => {
      list.push({
        title: item.title,
        description: item.description ?? "",
        originalIndex: item.originalIndex,
        resource: item.resource,
        details: item.details,
      });
    });
  return list;
});

const createEditorParams = (): CodeResolverParams["editor"] => {
  return {
    ...resolver.editor,
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

const recieveMessage = (data: CodeResolverEditorEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      visibleEditor.value = false;
      nextTick(() => initialize(value.initialize));
      break;
  }
};

defineExpose({
  recieveMessage,
});
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
                    <Paragraph :text="item.title" :highlight-text="keyword" />
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
                    <div v-if="item.resource.table">
                      <span>TABLE:</span>
                      <Paragraph
                        :text="item.resource.table.pattern"
                        :highlight-text="keyword"
                        style="display: inline-block"
                      />
                      <span v-if="item.resource.table.regex">(REGEX)</span>
                    </div>
                    <div>
                      <span>COLMUN:</span>
                      <Paragraph
                        :text="item.resource.column.pattern"
                        :highlight-text="keyword"
                        style="display: inline-block"
                      />
                      <span v-if="item.resource.column.regex">(REGEX)</span>
                    </div>
                  </td>
                  <td class="w100">-</td>
                  <td class="w150">-</td>
                  <td><Paragraph :text="item.description" :highlight-text="keyword" /></td>
                </tr>
              </template>
              <template v-else>
                <tr v-for="(detail, idx2) of item.details" :key="`${idx}-${idx2}`">
                  <td v-if="idx2 === 0" :rowspan="item.details.length" class="code-name">
                    <Paragraph :text="item.title" :highlight-text="keyword" />
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
                    <div v-if="item.resource.table">
                      <span>TABLE:</span>
                      <Paragraph
                        :text="item.resource.table.pattern"
                        :highlight-text="keyword"
                        style="display: inline-block"
                      />
                      <span v-if="item.resource.table.regex">(REGEX)</span>
                    </div>
                    <div>
                      <span>COLMUN:</span>
                      <Paragraph
                        :text="item.resource.column.pattern"
                        :highlight-text="keyword"
                        style="display: inline-block"
                      />
                      <span v-if="item.resource.column.regex">(REGEX)</span>
                    </div>
                  </td>
                  <td class="w100"><Paragraph :text="detail.code" :highlight-text="keyword" /></td>
                  <td class="w150"><Paragraph :text="detail.label" :highlight-text="keyword" /></td>
                  <td v-if="idx2 === 0" :rowspan="item.details.length">
                    <Paragraph :text="item.description" :highlight-text="keyword" />
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </section>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.cr-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

div.editor {
  padding: 5px;

  vscode-dropdown {
    z-index: 5;
  }
}
div.description {
  display: flex;
  flex-direction: row;
  column-gap: 5px;
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

fieldset.resource {
  flex-direction: column;
  margin-top: 3px;
  margin-bottom: 3px;

  & > table {
    width: 100%;

    vscode-dropdown,
    vscode-text-field {
      width: 100%;
    }
  }
}

fieldset.details {
  table {
    width: 100%;

    vscode-text-field {
      width: 100%;
    }
  }
}
label {
  margin-right: 4px;
}

.cr-scroll-wrapper {
  overflow: auto;
  flex-grow: 1;
}
section.items {
  padding: 5px;
  flex-grow: 1;
  display: flex;

  table {
    border-collapse: collapse;
    width: 100%;

    thead {
      position: sticky;
      top: 0;
      z-index: 2;
      background-color: var(--vscode-editorPane-background);

      th {
        height: 20px;
        padding: 2px;
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
        position: relative;
      }
    }

    th,
    td {
      border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
      padding: 2px;
      overflow: hidden;

      &.code-name,
      &.code-name {
        position: sticky;
        left: 0;
        z-index: 1;
        min-width: 255px;
        width: 255px;
        background-color: var(--vscode-editorPane-background);

        & > .controller {
          display: flex;
          justify-content: space-between;
          visibility: hidden;
        }
        &:hover > .controller {
          visibility: visible;
        }
      }
    }
  }

  span.label {
    display: inline-block;
    vertical-align: middle;
    height: 100%;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
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
