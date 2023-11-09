<script setup lang="ts">
import { ref } from "vue";
import {
  vscode,
  type CancelActionCommand,
  type WriteHttpEventToClipboardParams,
  type WriteHttpEventToClipboardParamsPanelEventData,
} from "@/utilities/vscode";
import type { DropdownItem } from "@/types/Components";
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
];

type InitParams = WriteHttpEventToClipboardParamsPanelEventData["value"]["initialize"];

const fileType = ref("markdown" as WriteHttpEventToClipboardParams["fileType"]);
const previewText = ref("");
const withRequest = ref(false);
const withResponse = ref(false);
const withCookies = ref(false);
const withBinary = ref(false);

const initialize = (v: InitParams): void => {
  if (v === undefined) {
    return;
  }
  fileType.value = v.params.fileType;

  withResponse.value = v.params.withResponse;
  withRequest.value = v.params.withRequest;
  withCookies.value = v.params.withCookies;
  withBinary.value = v.params.withBase64;
  previewText.value = v.previewText;
};

const handleChangeRequest = (checked: boolean) => {
  withRequest.value = checked;
  handleChange();
};

const handleChangeResponse = (checked: boolean) => {
  withResponse.value = checked;
  handleChange();
};

const handleChangeBinary = (checked: boolean) => {
  withBinary.value = checked;
  handleChange();
};

const handleChangeCookies = (checked: boolean) => {
  withCookies.value = checked;
  handleChange();
};

const handleChange = (refresh = true) => {
  vscode.postCommand({
    command: "writeHttpEventToClipboard",
    params: {
      fileType: fileType.value,
      specifyDetail: refresh,
      withCookies: withCookies.value,
      withRequest: withRequest.value,
      withResponse: withResponse.value,
      withBase64: withBinary.value,
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

const recieveMessage = (data: WriteHttpEventToClipboardParamsPanelEventData) => {
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
        <th>With</th>
        <td>
          <vscode-checkbox
            v-model="withRequest"
            :checked="withRequest === true"
            @change="($e:any) => handleChangeRequest($e.target.checked)"
            >Request</vscode-checkbox
          >
        </td>
        <td>
          <vscode-checkbox
            v-model="withResponse"
            :checked="withResponse === true"
            @change="($e:any) => handleChangeResponse($e.target.checked)"
            >Response</vscode-checkbox
          >
        </td>
        <td>
          <vscode-checkbox
            v-model="withCookies"
            :checked="withCookies === true"
            @change="($e:any) => handleChangeCookies($e.target.checked)"
            >Cookies</vscode-checkbox
          >
        </td>
      </tr>
      <tr>
        <th>With</th>
        <td colspan="3">
          <vscode-checkbox
            v-model="withBinary"
            :checked="withBinary === true"
            @change="($e:any) => handleChangeBinary($e.target.checked)"
            >Binary data in Base64 format
          </vscode-checkbox>
        </td>
      </tr>
    </table>
    <fieldset>
      <legend>Preview text</legend>
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
