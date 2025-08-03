<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type { SubscriptionSettingPanelEventData } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { toNum } from "@l-v-yonsama/rdh";
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit";
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const QosItems = ref([
  { label: "0: at most once", value: "0" },
  { label: "1: at least once", value: "1" },
  { label: "2: exactoly once", value: "2" },
] as DropdownItem[]);


const RhItems = ref([
  { label: "0: Always", value: "0" },
  { label: "1: If new", value: "1" },
  { label: "2: Never", value: "2" },
] as DropdownItem[]);

const name = ref("");
const qos = ref("0");
const nl = ref(false);
const rap = ref(true);
const rh = ref("0");
const isNew = ref(false);
const sectionHeight = ref(300);
let allTopicNames: string[] = [];

const nameErrorMessage = computed((): string => {
  const input = name.value;

  if (!input || input.trim() === "") {
    return "Topic name must not be empty!";
  }
  if (input.includes(" ")) {
    return "Topic name must not contain spaces!";
  }
  if (/[\u0000-\u001F\u007F]/.test(input)) {
    return "Topic name must not contain control characters!";
  }
  if (input.includes("//")) {
    return "Topic name must not contain consecutive slashes!";
  }
  if (allTopicNames.includes(input) && isNew.value) {
    return "Duplicate Topic name.";
  }
  return "";
});

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 56, 100);
  }
};

const initialize = async (v: SubscriptionSettingPanelEventData["value"]["initialize"]) => {
  if (v === undefined) {
    return;
  }

  name.value = v.name;
  qos.value = v.qos.toString();
  nl.value = v.nl;
  rap.value = v.rap;
  rh.value = v.rh.toString();
  isNew.value = v.isNew;
  allTopicNames = v.allTopicNames;

};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
  setTimeout(resetSpPaneWrapperHeight, 50);
  setTimeout(resetSpPaneWrapperHeight, 200);
});

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const ok = () => {
  vscode.postCommand({
    command: "ok",
    params: {
      name: name.value,
      qos: toNum(qos.value),
      nl: nl.value,
      rap: rap.value,
      rh: toNum(rh.value)
    },
  });
};

const recieveMessage = (data: SubscriptionSettingPanelEventData) => {
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
      <div class="tool-left"></div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton @click="ok" title="Save">
          <fa icon="plus" />Save
        </VsCodeButton>
      </div>
    </div>
    <section class="content scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div>
        <label for="name">Name:</label>
        <span v-if="!isNew" id="name" v-text="name"></span>
        <VsCodeTextField v-if="isNew" id="name" v-model="name" placeholder="e.g. sensor/temp/room1" :required="true">
        </VsCodeTextField>
        <p v-if="nameErrorMessage && isNew" class="marker-error" v-text="nameErrorMessage"></p>
      </div>
      <div>
        <label for="qos">QoS:</label>
        <VsCodeDropdown id="qos" v-model="qos" :items="QosItems" style="z-index: 15; width:148px" />
        <p style="opacity: 0.7;">Don’t receive your own messages</p>
      </div>
      <div>
        <label for="nl">No Local:</label>
        <vscode-checkbox :checked="nl" @change="($e: any) => { nl = $e.target.checked; }"
          style="margin-right: auto;margin-left: 10px;">No Local</vscode-checkbox>
      </div>
      <div>
        <label for="rap">Retain As Published:</label>
        <vscode-checkbox :checked="rap" @change="($e: any) => { rap = $e.target.checked; }"
          style="margin-right: auto;margin-left: 10px;">Retain As Published</vscode-checkbox>
        <p style="opacity: 0.7;">Preserve retain flag on retained messages</p>
      </div>
      <div>
        <label for="rh">Retain Handling:</label>
        <VsCodeDropdown id="rh" v-model="rh" :items="RhItems" style="z-index: 15; width:148px" />
      </div>

    </section>
  </section>
</template>

<style lang="scss" scoped>
section.root {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;

  &>* {
    margin: 10px;
  }
}

fieldset {
  margin-bottom: 15px;
}

.scroll-wrapper {
  overflow: auto;

  &>div {
    margin-bottom: 15px;

    &>p {
      margin: 2px 0 2px 155px;
    }
  }

  label {
    display: inline-block;
    margin-right: 5px;
    min-width: 150px;
  }
}

div.dropdown-area {
  margin-bottom: 3px;

  &>label {
    margin-top: 5px;
    display: inline-block;
    margin-right: 5px;
    min-width: 150px;
  }
}
</style>
