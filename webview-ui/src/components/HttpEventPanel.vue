<script setup lang="ts">
import { ref, defineExpose, onMounted, nextTick } from "vue";
import HttpResponseViewer from "./HttpResponseViewer.vue";
import HttpRequestViewer from "./HttpRequestViewer.vue";
import RDHViewer from "./RDHViewer.vue";
import {
  vsCodePanels,
  vsCodePanelView,
  vsCodePanelTab,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";
import {
  type HttpEventPanelEventData,
  type NodeRunAxiosEvent,
  type HttpEventPanelEventCodeBlocks,
  type WriteHttpEventToClipboardParams,
  vscode,
} from "@/utilities/vscode";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import type { SecondaryItem } from "@/types/Components";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

const displayReqSwitch = ref("res" as "req" | "res" | "cookies");

const isLoading = ref(true);
const loadingRate = ref(0);
const noRequest = ref(true);

const displayReqItems = [
  { label: "Request", value: "req" },
  { label: "Response", value: "res" },
  { label: "Cookies", value: "cookies" },
];

const moreDetailItems = [
  {
    kind: "selection",
    label: "Copy only request",
    value: {
      fileType: "markdown",
      withRequest: true,
      withResponse: false,
      withCookies: false,
      withBase64: false,
      specifyDetail: false,
    },
  },
  {
    kind: "selection",
    label: "Copy only response",
    value: {
      fileType: "markdown",
      withRequest: false,
      withResponse: true,
      withCookies: false,
      withBase64: false,
      specifyDetail: false,
    },
  },
  {
    kind: "selection",
    label: "Copy only cookies",
    value: {
      fileType: "markdown",
      withRequest: false,
      withResponse: false,
      withCookies: true,
      withBase64: false,
      specifyDetail: false,
    },
  },
  {
    kind: "divider",
  },
  {
    kind: "selection",
    label: "More",
    value: {
      fileType: "markdown",
      withRequest: true,
      withResponse: true,
      withCookies: true,
      withBase64: false,
      specifyDetail: true,
    },
  },
] as SecondaryItem<WriteHttpEventToClipboardParams>[];

const splitterWidth = ref(300);
const splitterHeight = ref(300);
const title = ref("");
const axiosEvent = ref(null as NodeRunAxiosEvent | null);
const codeBlocks = ref({} as HttpEventPanelEventCodeBlocks);

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.HttpEventPanel");
  if (sectionWrapper?.clientHeight) {
    splitterHeight.value = Math.max(sectionWrapper?.clientHeight - 30, 10);
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = Math.max(sectionWrapper.clientWidth - 14, 10);
  }
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
});

function handleOnChange(key: string, event: any) {}

const initialize = (params: HttpEventPanelEventData["value"]["initialize"]) => {
  if (!params) {
    return;
  }
  title.value = "";
  axiosEvent.value = null;

  nextTick(() => {
    title.value = params.title;
    axiosEvent.value = params.value;
    codeBlocks.value = params.codeBlocks;
    setTimeout(resetSpPaneWrapperHeight, 200);

    let noRequestVal = true;
    if (params.value.entry.request) {
      const method = params.value.entry.request.method.toLocaleLowerCase() ?? "";
      if (
        method === "get" ||
        method === "put" ||
        method === "patch" ||
        method === "post" ||
        method === "delete"
      ) {
        noRequestVal = false;
      }
    }
    noRequest.value = noRequestVal;
  });
};

const recieveMessage = (data: HttpEventPanelEventData) => {
  const { command, value } = data;

  switch (command) {
    case "loading":
      isLoading.value = true;
      loadingRate.value = value.loading ?? 0;
      break;
    case "initialize":
      isLoading.value = false;
      initialize(value.initialize);
      break;
  }
};

const writeToClipboard = (params: WriteHttpEventToClipboardParams): void => {
  vscode.postCommand({
    command: "writeHttpEventToClipboard",
    params: {
      ...params,
    },
  });
};

const createRequestScript = () => {
  vscode.postCommand({
    command: "createRequestScript",
    params: undefined,
  });
};

const selectedMoreOptions = (params: WriteHttpEventToClipboardParams): void => {
  vscode.postCommand({
    command: "writeHttpEventToClipboard",
    params: {
      ...params,
    },
  });
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section v-if="isLoading" class="HttpEventPanel loading">
    Now loading...( {{ loadingRate }}% )
  </section>
  <section v-else class="HttpEventPanel">
    <div class="tab-container-actions">
      <VsCodeRadioGroupVue
        v-model="displayReqSwitch"
        :items="displayReqItems"
        @change="($e:Event) => handleOnChange('andOrSwitch', $e)"
        class="switch"
      />

      <button
        :disabled="noRequest"
        @click="createRequestScript"
        title="Create request code in a new Notebook"
      >
        <fa icon="plus" />
      </button>
      <button
        @click="
          writeToClipboard({
            fileType: 'markdown',
            withRequest: true,
            withResponse: true,
            withCookies: false,
            withBase64: false,
            specifyDetail: false,
          })
        "
        title="Write to clipboard"
      >
        <fa icon="clipboard" />
      </button>
      <SecondarySelectionAction
        :items="moreDetailItems"
        title="..."
        @onSelect="selectedMoreOptions"
      />
    </div>

    <section class="contents" :style="{ width: `${splitterWidth}px` }">
      <div v-if="axiosEvent" class="spPaneWrapper">
        <HttpRequestViewer
          v-if="displayReqSwitch === 'req'"
          :res="axiosEvent"
          :header-code-block="codeBlocks.req?.headers ?? ''"
          :param-code-block="codeBlocks.req?.params ?? ''"
          :contents-code-block="codeBlocks.req?.contents ?? ''"
          :preview-content-type-info="codeBlocks.res.previewContentTypeInfo"
          :width="splitterWidth"
          :height="splitterHeight"
        />
        <HttpResponseViewer
          v-if="displayReqSwitch === 'res'"
          :res="axiosEvent"
          :header-code-block="codeBlocks.res.headers ?? ''"
          :contents-code-block="codeBlocks.res.contents ?? ''"
          :preview-content-type-info="codeBlocks.res.previewContentTypeInfo"
          :width="splitterWidth"
          :height="splitterHeight"
        />
        <div v-if="displayReqSwitch === 'cookies'">
          <div>Request Cookies</div>
          <RDHViewer
            v-if="codeBlocks.req.cookies != undefined"
            :rdh="codeBlocks.req.cookies"
            :width="splitterWidth"
            :height="Math.max(splitterHeight / 2 - 15, 15)"
            :readonly="true"
          />
          <div v-else>No data</div>
          <hr style="border-width: 0.5px" />
          <div>Response Cookies</div>
          <RDHViewer
            v-if="codeBlocks.res.cookies != undefined"
            :rdh="codeBlocks.res.cookies"
            :width="splitterWidth"
            :height="Math.max(splitterHeight / 2 - 15, 15)"
            :readonly="true"
          />
          <div v-else>No data</div>
        </div>
      </div>
    </section>
  </section>
</template>

<style lang="scss" scoped>
section.HttpEventPanel {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;

  section.contents {
    margin-top: 33px;
  }
}
</style>
