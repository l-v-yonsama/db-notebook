<script setup lang="ts">
import { ref } from "vue";
import {
  vscode,
  type CancelActionCommand,
  type WriteToClipboardParams,
  type WriteToClipboardParamsPanelEventData,
} from "@/utilities/vscode";
import type { DropdownItem } from "@/types/Components";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
provideVSCodeDesignSystem().register(vsCodeCheckbox());

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

type InitParams = WriteToClipboardParamsPanelEventData["value"]["initialize"];

const fileType = ref("text" as WriteToClipboardParams["fileType"]);
const previewText = ref("");
const withType = ref(false);
const withComment = ref(false);
const limit = ref(10);
const limitCell = ref(100);
const withRowNo = ref(false);
const withCodeLabel = ref(false);
const withRuleViolation = ref(false);

const initialize = (v: InitParams): void => {
  if (v === undefined) {
    return;
  }
  fileType.value = v.params.fileType;
  const { outputWithType } = v.params;
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
  limit.value = v.params.limit ?? 10;
  limitCell.value = v.params.limitCell ?? 100;
  withRowNo.value = v.params.withRowNo;
  withCodeLabel.value = v.params.withCodeLabel;
  withRuleViolation.value = v.params.withRuleViolation;
  previewText.value = v.previewText;
};

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

const handleChangeResolvedLabel = (checked: boolean) => {
  withCodeLabel.value = checked;
  handleChange();
};

const handleChangeRuleViolation = (checked: boolean) => {
  withRuleViolation.value = checked;
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

  vscode.postCommand({
    command: "writeToClipboard",
    params: {
      tabId: "",
      fileType: fileType.value,
      outputWithType,
      limit: limit.value,
      limitCell: limitCell.value,
      specifyDetail: refresh,
      withRowNo: withRowNo.value,
      withCodeLabel: withCodeLabel.value,
      withRuleViolation: withRuleViolation.value,
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

const recieveMessage = (data: WriteToClipboardParamsPanelEventData) => {
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
        <td>&nbsp;</td>
        <td>
          <vscode-checkbox
            v-model="withType"
            :checked="withType === true"
            @change="($e:any) => handleChangeType($e.target.checked)"
            >Type</vscode-checkbox
          >
        </td>
        <td>
          <vscode-checkbox
            v-model="withComment"
            :checked="withComment === true"
            @change="($e:any) => handleChangeComment($e.target.checked)"
            >Comment</vscode-checkbox
          >
        </td>
        <td>
          <vscode-checkbox
            v-model="withRowNo"
            :checked="withRowNo === true"
            @change="($e:any) => handleChangeRowNo($e.target.checked)"
            >Row no</vscode-checkbox
          >
        </td>
      </tr>
      <tr>
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
        <th>Limit cell characters</th>
        <td>
          <VsCodeTextField
            v-model="limitCell"
            type="number"
            :max="30000"
            :min="0"
            @change="handleChange(true)"
          ></VsCodeTextField>
        </td>
      </tr>
      <tr>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>
          <vscode-checkbox
            v-model="withCodeLabel"
            :checked="withCodeLabel === true"
            @change="($e:any) => handleChangeResolvedLabel($e.target.checked)"
            >Resolved Label</vscode-checkbox
          >
        </td>
        <td>
          <vscode-checkbox
            v-model="withRuleViolation"
            :checked="withRuleViolation === true"
            @change="($e:any) => handleChangeRuleViolation($e.target.checked)"
            >Rule violation</vscode-checkbox
          >
        </td>
      </tr>
    </table>
    <fieldset>
      <legend>Preview text (Displayable preview records is 10)</legend>
      <textarea readonly :value="previewText" wrap="off"></textarea>
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
