<script setup lang="ts">
import { ref } from "vue";
import { vscode, type CancelActionCommand, type WriteToClipboardParams } from "@/utilities/vscode";
import type { DropdownItem } from "@/types/Components";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeCheckbox());

type Props = {
  params: {
    params: WriteToClipboardParams;
    previewText: string;
  };
};
const props = defineProps<Props>();

const fileTypeItems: DropdownItem[] = [
  {
    label: "Plain text",
    value: "text",
  },
  {
    label: "Markdown",
    value: "markdown",
  },
  {
    label: "CSV",
    value: "csv",
  },
  {
    label: "TSV",
    value: "tsv",
  },
];

const fileType = ref(props.params.params.fileType);
const withType = ref(false);
const withComment = ref(false);
const limit = ref(props.params.params.limit ?? 10);
const withRowNo = ref(props.params.params.withRowNo);

const { outputWithType } = props.params.params;
switch (outputWithType) {
  case "both":
    withType.value = true;
    withComment.value = true;
    break;
  case "withComment":
    withComment.value = true;
    break;
  case "withType":
    withType.value = true;
    break;
}

const handleChangeType = (checked: boolean) => {
  withType.value = checked;
  handleChange();
};

const handleChangeComment = (checked: boolean) => {
  withComment.value = checked;
  handleChange();
};

const handleChangeRowNo = (checked: boolean) => {
  withRowNo.value = checked;
  handleChange();
};

const handleChange = (refresh = true) => {
  let outputWithType: WriteToClipboardParams["outputWithType"] = "none";
  if (withType.value) {
    if (withComment.value) {
      outputWithType = "both";
    } else {
      outputWithType = "withType";
    }
  } else {
    if (withComment.value) {
      outputWithType = "withComment";
    }
  }
  console.log("L94 ;", outputWithType);

  vscode.postCommand({
    command: "writeToClipboard",
    params: {
      tabId: "",
      fileType: fileType.value,
      outputWithType,
      limit: limit.value,
      specifyDetail: refresh,
      withRowNo: withRowNo.value,
    },
  });
};

const cancel = () => {
  const action: CancelActionCommand = {
    command: "cancel",
    params: {},
  };
  vscode.postCommand(action);
};
</script>

<template>
  <section>
    <table>
      <tr>
        <th>Format</th>
        <td>
          <VsCodeDropdown v-model="fileType" :items="fileTypeItems" @change="handleChange(true)" />
        </td>
        <td colspan="2" style="text-align: right">
          <VsCodeButton
            @click="cancel"
            appearance="secondary"
            title="Cancel"
            style="margin-right: 3px"
            >Cancel</VsCodeButton
          >
          <VsCodeButton @click="handleChange(false)" title="Copy to clipboard"
            ><span class="codicon codicon-clippy"></span>Copy to clipboard</VsCodeButton
          >
        </td>
      </tr>
      <tr>
        <th>Type</th>
        <td>
          <vscode-checkbox
            v-model="withType"
            :checked="withType === true"
            @change="($e:any) => handleChangeType($e.target.checked)"
            >with type</vscode-checkbox
          >
        </td>
        <th>Comment</th>
        <td>
          <vscode-checkbox
            v-model="withComment"
            :checked="withComment === true"
            @change="($e:any) => handleChangeComment($e.target.checked)"
            >with comment</vscode-checkbox
          >
        </td>
      </tr>
      <tr>
        <th>Row no</th>
        <td>
          <vscode-checkbox
            v-model="withRowNo"
            :checked="withRowNo === true"
            @change="($e:any) => handleChangeRowNo($e.target.checked)"
            >with row no</vscode-checkbox
          >
        </td>
        <th>Limit rows</th>
        <td>
          <VsCodeTextField
            v-model="limit"
            type="number"
            :max="10000"
            :min="0"
            @change="handleChange(true)"
          ></VsCodeTextField>
        </td>
      </tr>
    </table>
    <fieldset>
      <legend>Preview text</legend>
      <textarea readonly :value="params.previewText" wrap="off"></textarea>
    </fieldset>
  </section>
</template>

<style scoped>
section {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
table {
  width: 100%;
}
fieldset {
  flex-grow: 1;
}
textarea {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--foreground);
}
</style>
