<script setup lang="ts">
import { onMounted, ref, nextTick } from "vue";
import {
  vscode,
  type UpdateCodeResolverTextDocumentActionCommand,
  type CodeResolver,
  type NameWithComment,
  type CodeItem,
  type CodeItemDetail,
} from "@/utilities/vscode";
import type { DropdownItem } from "@/types/Components";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
import type { DbSchema } from "@l-v-yonsama/multi-platform-database-drivers";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

type Props = {
  connectionSettingNames: string[];
  tableNameList: NameWithComment[];
  columnNameList: NameWithComment[];
  resolver: CodeResolver;
  scrollPos: number;
};
const props = defineProps<Props>();

const sectionHeight = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.cr-root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 53, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
  const wrapper = document.querySelector(".cr-scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = props.scrollPos ?? 0;
  }
});

const connectionName = ref(props.resolver.connectionName);
const connectionItems = props.connectionSettingNames.map((it) => ({ label: it, value: it }));

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

const items = ref(props.resolver.items);

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const updateTextDocument = (
  values?: UpdateCodeResolverTextDocumentActionCommand["params"]["values"]
) => {
  const obj: CodeResolver = {
    connectionName: connectionName.value,
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

const handleChangeSpecifyResourceTable = (item: CodeItem, specify: boolean) => {
  if (specify) {
    item.resource.table = {
      pattern: "",
      regex: false,
    };
  } else {
    item.resource.table = undefined;
  }
  updateTextDocument();
};

const handleChangeRegexResource = (target: CodeItem, key: string, checked: boolean) => {
  if (key === "table") {
    target.resource.table!.regex = checked;
  } else {
    target.resource.column.regex = checked;
  }
  updateTextDocument();
};

const addDetail = (item: CodeItem) => {
  item.details.push({
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

const deleteDetail = (item: CodeItem, index: number) => {
  item.details.splice(index, 1);
  updateTextDocument();
};
</script>

<template>
  <section class="cr-root">
    <div class="toolbar">
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
        <VsCodeButton @click="cancel" appearance="secondary" title="Cansel"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton @click="updateTextDocument({ name: 'add-code-item' })" title="Add code item"
          ><fa icon="plus" />Add code item</VsCodeButton
        >
      </div>
    </div>
    <section class="items">
      <div class="cr-scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
        <section class="item" v-for="(item, idx) of items" :key="idx">
          <div class="code-name">
            <label :for="`codeName${idx}`">Code name</label>
            <VsCodeTextField
              :id="`codeName${idx}`"
              v-model="item.title"
              :maxlength="128"
              :transparent="true"
              :required="true"
              style="flex-grow: 1"
              @change="updateTextDocument()"
            />
            <VsCodeButton
              @click="updateTextDocument({ name: 'delete-code-item', detail: idx })"
              title="Delete code"
              appearance="secondary"
              ><fa icon="trash" />Delete code</VsCodeButton
            >
            <VsCodeButton
              @click="updateTextDocument({ name: 'duplicate-code-item', detail: idx })"
              title="Duplicate code"
              ><fa icon="plus" />Duplicate code</VsCodeButton
            >
          </div>
          <div class="description">
            <label :for="`description${idx}`">Description</label>
            <VsCodeTextField
              :id="`description${idx}`"
              v-model="item.description"
              :maxlength="256"
              :transparent="true"
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
                      :checked="item.resource.table !== undefined"
                      @change="($e:any) => handleChangeSpecifyResourceTable(item, $e.target.checked)"
                      style="margin-right: auto"
                      >Specify table</vscode-checkbox
                    >
                  </td>
                  <td style="width: 170px">
                    <template v-if="item.resource.table !== undefined">
                      <vscode-checkbox
                        :checked="item.resource.table.regex"
                        @change="($e:any) => handleChangeRegexResource(item,'table', $e.target.checked)"
                        >Regular expression</vscode-checkbox
                      >
                    </template>
                  </td>
                  <td>
                    <template v-if="item.resource.table !== undefined">
                      <VsCodeDropdown
                        v-if="!item.resource.table.regex"
                        :id="`resourceTable${idx}`"
                        v-model="item.resource.table.pattern"
                        :items="tableItems"
                        :transparent="true"
                        :required="true"
                        @change="updateTextDocument()"
                      ></VsCodeDropdown>

                      <VsCodeTextField
                        v-if="item.resource.table.regex"
                        :id="`resourceTable${idx}`"
                        v-model="item.resource.table.pattern"
                        :maxlength="256"
                        :transparent="true"
                        :required="true"
                        @change="updateTextDocument()"
                      ></VsCodeTextField>
                    </template>
                  </td>
                </tr>
                <tr>
                  <td>
                    <label :for="`resourceColumn${idx}`">Column</label>
                  </td>
                  <td>
                    <vscode-checkbox
                      :checked="item.resource.column.regex"
                      @change="($e:any) => handleChangeRegexResource(item, 'column', $e.target.checked)"
                      >Regular expression</vscode-checkbox
                    >
                  </td>
                  <td>
                    <VsCodeDropdown
                      v-if="!item.resource.column.regex"
                      :id="`resourceColumn${idx}`"
                      v-model="item.resource.column.pattern"
                      :items="columnItems"
                      :transparent="true"
                      :required="true"
                      @change="updateTextDocument()"
                    ></VsCodeDropdown>

                    <VsCodeTextField
                      v-if="item.resource.column.regex"
                      :id="`resourceColumn${idx}`"
                      v-model="item.resource.column.pattern"
                      :maxlength="256"
                      :transparent="true"
                      :required="true"
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
                class="fillBackGround"
                @click="addDetail(item)"
                title="Add detail"
                appearance="secondary"
                style="margin-left: 2px"
                ><fa icon="plus" />Add detail</VsCodeButton
              >
            </legend>
            <table v-if="item.details.length > 0">
              <thead>
                <tr>
                  <th class="no">No</th>
                  <th class="code">Code</th>
                  <th class="label">Label</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(detail, idx2) of item.details">
                  <td class="no" style="text-align: right">{{ idx2 + 1 }}</td>
                  <td class="code">
                    <VsCodeTextField
                      v-model="item.details[idx2].code"
                      :maxlength="256"
                      :transparent="true"
                      :required="true"
                      @change="changeDetail(detail)"
                    ></VsCodeTextField>
                  </td>
                  <td class="label">
                    <VsCodeTextField
                      v-model="item.details[idx2].label"
                      :maxlength="256"
                      :transparent="true"
                      :required="true"
                      style="flex-grow: 1"
                      @change="changeDetail(detail)"
                    ></VsCodeTextField>
                  </td>
                  <td style="width: 85px">
                    <VsCodeButton
                      class="fillBackGround"
                      @click="deleteDetail(item, idx2)"
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
        </section>
      </div>
    </section>
  </section>
</template>

<style scoped>
.cr-root {
  width: 100%;
  height: 100%;
  margin: 3px;
  padding: 1px;
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
.toolbar {
  padding: 3px 4px;
  margin-bottom: 13px;
  display: flex;
}
.tool-left {
  flex-grow: 1;
  align-items: center;
  display: flex;
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
  background-color: rgba(10, 10, 10, 0.4);
}
legend {
  width: -webkit-fill-available;
}
.details fieldset legend > span {
  margin-right: auto;
}
fieldset.resource {
  flex-direction: column;
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
.cr-scroll-wrapper {
  overflow: auto;
}
</style>
