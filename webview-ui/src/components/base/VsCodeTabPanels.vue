<template>
  <vscode-panels class="tab-wrapper" :activeid="activeTabId" aria-label="With Active Tab">
    <VsCodeTabHeader
      v-for="tabItem in tabItems"
      :id="tabItem.tabId"
      :key="tabItem.tabId"
      :title="titleFormatter ? titleFormatter(tabItem) : `${tabItem.title}`"
      :is-active="isActiveTabId(tabItem.tabId)"
      :closable="true"
      @clicked="handleOnClickTab(tabItem.tabId)"
      @close="handleOnCloseTab(tabItem.tabId)"
    />
    <vscode-panel-view
      v-for="tabItem of tabItems"
      :id="'view-' + tabItem.tabId"
      :key="tabItem.tabId"
      :style="viewPadding ? { padding: viewPadding } : undefined"
    >
      <slot :tab-item="tabItem" :active="isActiveTabId(tabItem.tabId)"></slot>
    </vscode-panel-view>
  </vscode-panels>
</template>

<script setup lang="ts">
import type { TabItemLike } from "@/types/Components";
import { provideVSCodeDesignSystem, vsCodePanels, vsCodePanelView } from "@vscode/webview-ui-toolkit";
import VsCodeTabHeader from "./VsCodeTabHeader.vue";
// vsCodePanelTab is registered by VsCodeTabHeader.
provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView());

const props = defineProps<{
  tabItems: TabItemLike[];
  // "tab-" prefixed id, as managed by each caller.
  activeTabId: string;
  titleFormatter?: (tabItem: TabItemLike) => string;
  viewPadding?: string;
}>();

const emit = defineEmits<{
  (event: "clickTab", tabId: string): void;
  (event: "closeTab", tabId: string): void;
}>();

const isActiveTabId = (tabId: string): boolean => props.activeTabId === `tab-${tabId}`;

const handleOnClickTab = (tabId: string) => {
  emit("clickTab", tabId);
};

const handleOnCloseTab = (tabId: string) => {
  emit("closeTab", tabId);
};
</script>
<style scoped></style>
