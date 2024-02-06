<script setup lang="ts">
import { ref } from "vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import {
  vsCodePanels,
  vsCodePanelView,
  vsCodePanelTab,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";
import type { HttpResponseTabItem } from "@/utilities/vscode";
import type { ContentTypeInfo } from "@l-v-yonsama/multi-platform-database-drivers";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

type NodeRunAxiosEvent = HttpResponseTabItem["list"][0];

type Props = {
  width: number;
  height: number;
  res: NodeRunAxiosEvent;
  url: string;
  headerCodeBlock: string;
  contentsCodeBlock: string;
  previewContentTypeInfo: ContentTypeInfo | undefined;
};

const props = defineProps<Props>();

const width = Math.max(10, props.width - 4);
const height = Math.max(10, props.height - 83);
const imgSrc = ref("");
const visibleFontPreview = ref(false);
const fontPreviewText = ref("Hello world\nこんにちは　世界\n0123456789\n!@#$%^&*()-=");

const status = ref(
  `${props.res.entry.response.status} ${props.res.entry.response.statusText} ${
    Math.floor(props.res.entry.response.status / 100) <= 3 ? "😀" : "😱"
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
] as TabItemType[]);

const showTab = (tabId: string) => {
  activeTabId.value = tabId;
};

if (props.previewContentTypeInfo) {
  const { renderType, contentType } = props.previewContentTypeInfo;

  if (renderType === "Image" && props.res.entry.response.content.text) {
    const { text } = props.res.entry.response.content;
    tabItems.value.push({
      tabId: "preview",
      title: "Preview",
      isCode: false,
    });

    if (contentType === "image/svg+xml") {
      imgSrc.value = `data:image/svg+xml,${encodeURIComponent(text)}`;
    } else {
      imgSrc.value = `data:${contentType};base64,${text}`;
    }
  } else if (renderType === "Font" && props.res.entry.response.content.text) {
    tabItems.value.push({
      tabId: "preview",
      title: "Preview",
      isCode: false,
    });

    visibleFontPreview.value = true;
  }
}
</script>

<template>
  <section class="HttpResponseViewer">
    <p class="header-summary">
      <label for="status">STATUS:</label><span id="status">{{ status }}</span>
      <label for="content-type">Content-Type:</label
      ><span id="content-type">{{ props.res.entry.response.content.mimeType }}</span>
      <label for="elapsed-time">Elapsed Time:</label
      ><span id="elapsed-time">{{ Math.round(props.res.entry.time) ?? "-" }}msec</span>
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
    <vscode-panel-view id="view-headers" class="panel-view">
      <div v-if="activeTabId === 'headers'" class="code" :style="{ height: `${height}px` }">
        <section v-if="headerCodeBlock" v-html="headerCodeBlock"></section>
        <span v-else>No headers</span>
      </div>
    </vscode-panel-view>
    <vscode-panel-view id="view-data" class="panel-view">
      <div v-if="activeTabId === 'data'" class="code" :style="{ height: `${height}px` }">
        <section v-if="contentsCodeBlock" v-html="contentsCodeBlock"></section>
        <template v-else>
          <span v-if="imgSrc">See Preview tab</span>
          <span v-else>No data available for display</span>
        </template>
      </div>
    </vscode-panel-view>
    <vscode-panel-view id="view-preview">
      <div class="preview-pane" v-if="activeTabId === 'preview'" :style="{ height: `${height}px` }">
        <img
          v-if="imgSrc"
          :style="{ 'max-height': `${height}px`, 'max-width': `${width}px` }"
          :src="imgSrc"
        />
        <p v-else-if="visibleFontPreview" class="fontPreview" rows="6">{{ fontPreviewText }}</p>
      </div>
    </vscode-panel-view>
  </section>
</template>

<style lang="scss" scoped>
section.HttpResponseViewer {
  vscode-panel-view {
    padding: 0 6px;
    & > div {
      margin: 4px;
    }
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

  .panel-view {
    width: 100%;
    height: 100%;

    div.code {
      width: 100%;
      overflow: auto;
      white-space: pre;
    }
  }

  .preview-pane {
    width: 100%;
    .fontPreview {
      font-family: harFontPreview;
      font-size: xx-large;
      white-space: pre-wrap;
    }
  }
}
</style>
