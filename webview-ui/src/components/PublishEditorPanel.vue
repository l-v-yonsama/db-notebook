<script setup lang="ts">
import type { DropdownItem, SecondaryItem } from "@/types/Components";
import {
  vscode,
  type PublishEditorPanelEventData,
  type PublishEditorParams
} from "@/utilities/vscode";
import {
  provideVSCodeDesignSystem,
  vsCodeCheckbox,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import { computed, nextTick, onMounted, ref } from "vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextArea from "./base/VsCodeTextArea.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

provideVSCodeDesignSystem().register(
  vsCodeCheckbox(),
  vsCodePanelView(),

);

const QosItems = ref([
  { label: "0: at most once", value: "0" },
  { label: "1: at least once", value: "1" },
  { label: "2: exactoly once", value: "2" },
] as DropdownItem[]);

const langItems: DropdownItem[] = [
  {
    label: "JSON",
    value: "json",
  },
  {
    label: "Plain text",
    value: "plain",
  },
  {
    label: "Javascript",
    value: "javascript",
  },
];
const numOfPayloadsItems = ref([] as DropdownItem[]);

for (let i of [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000]) {
  numOfPayloadsItems.value.push({
    label: `${i}`,
    value: i,
  });
}

type MoreOption = "new" | "active";

const moreDetailItems = [
  {
    kind: "selection",
    label: "Display in new notebook",
    value: "new",
  },
  {
    kind: "selection",
    label: "Display in active notebook",
    value: "active",
  },
] as SecondaryItem<MoreOption>[];

const inProgress = ref(false);
const conName = ref("");
const subscriptionName = ref("");
const qos = ref("0");
const payload = ref("");
const retain = ref(false);
const langType = ref("json" as PublishEditorParams['langType']);
const numOfPayloads = ref(10);
const splitterWidth = ref(300);
const sectionHeight = ref(300);

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.PublishEditorPanel");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 60, 10);
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = sectionWrapper.clientWidth - 14;
  }
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
  setTimeout(resetSpPaneWrapperHeight, 50);
  setTimeout(resetSpPaneWrapperHeight, 200);
});

const executable = computed(() => !inProgress.value && subscriptionName.value.length > 0 && (langType.value === 'javascript' || payload.value.length > 0));

const initialize = async (v: PublishEditorPanelEventData["value"]["initialize"]): Promise<void> => {
  if (v === undefined) {
    return;
  }

  conName.value = v.conName;
  subscriptionName.value = v.subscriptionName;
  langType.value = v.langType;
  numOfPayloads.value = v.numOfPayloads;

  stopProgress();
  await nextTick();
};


const stopProgress = (): void => {
  inProgress.value = false;
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const ok = (openInNotebook: boolean, inActiveNotebook?: boolean) => {
  const params: PublishEditorParams = {
    subscriptionName: subscriptionName.value,
    retain: retain.value,
    qos: qos.value,
    payload: payload.value,
    langType: langType.value,
    numOfPayloads: numOfPayloads.value,
    openInNotebook,
    inActiveNotebook: inActiveNotebook ?? false, // Use the passed value or default to false
  };

  vscode.postCommand({
    command: "ok",
    params,
  });
};

const selectedMoreOptions = (v: MoreOption): void => {
  ok(true, v === "active");
};

const recieveMessage = (data: PublishEditorPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
    case "stop-progress":
      stopProgress();
      break;
  }
};



defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="PublishEditorPanel">
    <div class="toolbar">
      <div class="tool-left">
        <label for="conName">Name:</label>
        <span id="conName">{{ conName }}</span>
        <label for="subscription">Topic:</label>
        <VsCodeTextField id="subscription" v-model="subscriptionName" :maxlength="2048" style="width: 300px"
          title="Specify the MQTT subscription to publish or subscribe. Use '/' for hierarchy. Wildcards like '+' and '#' are allowed only for subscriptions."
          placeholder="Enter subscription topic name (e.g. sensor/temp)">
        </VsCodeTextField>
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Close panel" style="margin-right: 5px">
          <fa icon="times" />Close panel
        </VsCodeButton>
        <VsCodeButton :disabled="!executable" @click="ok(true)" appearance="secondary" title="Open in notebook"
          style="margin-right: 5px">
          <fa icon="book" />Open in notebook
        </VsCodeButton>
        <SecondarySelectionAction :items="moreDetailItems" title="more" @onSelect="selectedMoreOptions" />
        <VsCodeButton v-if="langType !== 'javascript'" :disabled="!executable" @click="ok(false)" title="Execute">
          <fa icon="check" />Execute
        </VsCodeButton>
      </div>
    </div>
    <div class="scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="settings">
        <div>
          <label for="langType">Lang:</label>
          <VsCodeDropdown id="langType" v-model="langType" :items="langItems" style="z-index: 15; width:120px" />

          <label for="qos" style="margin-left: 10px;">QOS:</label>
          <VsCodeDropdown id="qos" v-model="qos" :items="QosItems" style="z-index: 15; width:148px" />

          <vscode-checkbox :checked="retain" @change="($e: any) => { retain = $e.target.checked; }"
            style="margin-right: auto;margin-left: 10px;">Retain</vscode-checkbox>

          <label v-if="langType === 'javascript'" for="numOfPayloads"> Num of records </label>
          <VsCodeDropdown v-if="langType === 'javascript'" id="numOfPayloads" v-model="numOfPayloads"
            :items="numOfPayloadsItems" style="z-index: 15" />
        </div>
        <div v-if="langType !== 'javascript'" class="editor">
          <fieldset class="conditions">
            <legend>
              <span style="margin-right: 30px">Payload</span>
            </legend>

            <VsCodeTextArea id="queryContent" v-model="payload" :maxlength="3 * 1024 * 1024" :rows="10"
              title="Query content" placeholder="Enter query content" style="height: 97%; width:100%">
            </VsCodeTextArea>
          </fieldset>
        </div>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
section.PublishEditorPanel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  &>div {
    margin: 5px;

    &.toolbar {
      margin-bottom: 0px !important;

      .tool-left {
        label {
          margin-right: 5px;
        }

        label:nth-child(n+2) {
          margin-left: 25px;
        }

        span {
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          max-width: 180px;
        }
      }
    }

    &.scroll-wrapper {
      overflow: auto;

      fieldset.conditions {
        margin-top: 7px;

        div {
          margin-top: 5px;

          label {
            min-width: 180px;
            display: inline-block;
          }

          vscode-dropdown {
            margin-right: 6px;
          }
        }
      }


    }
  }
}
</style>
