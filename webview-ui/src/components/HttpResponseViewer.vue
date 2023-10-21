<script setup lang="ts">
import { ref, computed } from "vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import {
  vsCodePanels,
  vsCodePanelView,
  vsCodePanelTab,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";
import type {
  CloseTabActionCommand,
  OutputParams,
  WriteToClipboardParams,
  HttpResponsesPanelEventData,
  HttpResponseTabItem,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

type NodeRunAxiosResponse = HttpResponseTabItem["list"][0];

type Props = {
  width: number;
  height: number;
  res: NodeRunAxiosResponse;
};

const props = defineProps<Props>();

const width = Math.max(10, props.width - 4);
const height = Math.max(10, props.height - 83);
const code = ref("");
const codeLang = ref("json");
const imgSrc = ref("");

const status = ref(
  `${props.res.status} ${props.res.statusText} ${
    Math.floor(props.res.status / 100) <= 3 ? "😀" : "😱"
  }`
);

const activeTabId = ref("data");

type TabItemType = {
  tabId: string;
  title: string;
  isCode: boolean;
};
const tabItems = ref([
  {
    tabId: "headers",
    title: "Headers",
    isCode: true,
  },
  {
    tabId: "data",
    title: "Data",
    isCode: true,
  },
  {
    tabId: "preview",
    title: "Preview",
    isCode: false,
  },
] as TabItemType[]);

const showTab = (tabId: string) => {
  activeTabId.value = tabId;
  reset();
};

const reset = () => {
  const { headers, data, contentTypeInfo } = props.res;
  const { renderType, contentType } = contentTypeInfo;
  const ltype = contentType.toLowerCase();

  codeLang.value = "text";
  imgSrc.value = "";

  if (tabItems.value.length > 2) {
    tabItems.value.splice(2, 1);
  }

  if (renderType === "Image") {
    tabItems.value.push({
      tabId: "preview",
      title: "Preview",
      isCode: false,
    });
  }

  if (activeTabId.value === "headers") {
    code.value = JSON.stringify(headers, null, 2);
    codeLang.value = "json";
  } else if (activeTabId.value === "data") {
    code.value = "";
    if (data) {
      if (renderType === "Text") {
        if (ltype.indexOf("application/json") >= 0) {
          code.value = JSON.stringify(data, null, 2);
          codeLang.value = "json";
        } else {
          code.value = data;
          if (ltype.indexOf("text/html") >= 0) {
            codeLang.value = "html";
            // } else if (ltype.indexOf("text/html") >= 0) {
            //   codeLang.value = "html";
          }
        }
      } else if (renderType === "Image") {
        if (contentType === "image/svg+xml") {
          code.value = data;
          codeLang.value = "xml";
        } else {
          code.value = "See the Preview tab.";
        }
      }
    }
  } else if (activeTabId.value === "preview") {
    if (data) {
      if (renderType === "Image") {
        if (contentType === "image/svg+xml") {
          imgSrc.value = `data:image/svg+xml,${encodeURIComponent(data)}`;
        } else {
          imgSrc.value = `data:${contentType};base64,${data}`;
        }
      }
    }
  }
};

reset();
</script>

<template>
  <section class="HttpResponseViewer">
    <p class="header-summary">
      <label for="status">STATUS:</label><span id="status">{{ status }}</span>
      <label for="content-type">Content-Type:</label
      ><span id="content-type">{{ props.res.contentTypeInfo.contentType }}</span>
      <label for="elapsed-time">Elapsed Time:</label
      ><span id="elapsed-time">{{ props.res.elapsedTime ?? "-" }}msec</span>
    </p>
    <VsCodeTabHeader
      v-for="tabItem in tabItems"
      :id="tabItem.tabId"
      :key="tabItem.tabId"
      :title="`${tabItem.title}`"
      :is-active="activeTabId === tabItem.tabId"
      :closable="false"
      @click="showTab(tabItem.tabId)"
    >
    </VsCodeTabHeader>
    <vscode-panel-view id="view-headers">
      <div
        v-if="activeTabId === 'headers'"
        class="code"
        :style="{ height: `${height}px`, width: `${width}px` }"
      >
        <SshPre :dark="true" :language="codeLang" :label="codeLang">{{ code }}</SshPre>
      </div>
    </vscode-panel-view>
    <vscode-panel-view id="view-data">
      <div
        v-if="activeTabId === 'data'"
        class="code"
        :style="{ height: `${height}px`, width: `${width}px` }"
      >
        <SshPre :dark="true" :language="codeLang" :label="codeLang">{{ code }}</SshPre>
      </div>
    </vscode-panel-view>
    <vscode-panel-view id="view-preview">
      <template v-if="activeTabId === 'preview'">
        <img
          v-if="imgSrc"
          :style="{ 'max-height': `${height}px`, 'max-width': `${width}px` }"
          :src="imgSrc"
        />
      </template>
    </vscode-panel-view>
  </section>
</template>

<style lang="scss" scoped>
section.HttpResponseViewer {
  vscode-panel-view {
    padding: 4px;
  }

  .header-summary {
    label {
      font-weight: bold;
      margin-right: 3px;
    }
    span {
      margin-right: 6px;
      font-size: smaller;
    }
  }

  div.code {
    overflow: auto;
  }
}
</style>
