<script setup lang="ts">
import { ref, defineExpose, onMounted, nextTick } from "vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import HttpResponseViewer from "./HttpResponseViewer.vue";
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
import type { DropdownItem } from "@/types/Components";
import { OUTPUT_DETAIL_ITEMS, WRITE_TO_CLIP_BOARD_DETAIL_ITEMS } from "@/constants";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

type NodeRunAxiosResponse = HttpResponseTabItem["list"][0];

const activeTabId = ref("");
const tabItems = ref([] as HttpResponseTabItem[]);
const inProgress = ref(false);
const splitterWidth = ref(300);
const splitterHeight = ref(300);
const innerTabIndex = ref(-1);
const innerTabItems = ref([] as DropdownItem[]);
const activeInnerResponse = ref(null as NodeRunAxiosResponse | null);
const contentMode = ref("tab" as "tab" | "keys");
const activeTabResList = ref([] as NodeRunAxiosResponse[]);

// secondarySelections
const outputDetailItems = OUTPUT_DETAIL_ITEMS;
const writeToClipboardDetailItems = WRITE_TO_CLIP_BOARD_DETAIL_ITEMS;

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.HttpResponsesPanel");
  if (sectionWrapper?.clientHeight) {
    splitterHeight.value = Math.max(sectionWrapper?.clientHeight - 41, 10);
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = Math.max(sectionWrapper.clientWidth - 14, 10);
  }
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
});

const refreshable = ref(false);

function getActiveTabItem(): HttpResponseTabItem | undefined {
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as HttpResponseTabItem;
}

function isActiveTabId(tabId: string): boolean {
  const id = activeTabId.value.substring(4); // 'tab-'
  return tabId === id;
}

const showTab = (tabId: string) => {
  activeTabId.value = `tab-${tabId}`;
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  innerTabItems.value.splice(0, innerTabItems.value.length);
  activeTabResList.value.splice(0, activeTabResList.value.length);
  tabItem.list.forEach((res: NodeRunAxiosResponse, idx) => {
    const label = res.title;
    innerTabItems.value.push({ value: idx, label });
    activeTabResList.value.push(res);
  });
  innerTabIndex.value = tabItem.list.length > 0 ? 0 : -1;
  resetactiveInnerResponse();
  vscode.postCommand({ command: "selectTab", params: { tabId } });
};

const resetactiveInnerResponse = () => {
  refreshable.value = false;
  activeInnerResponse.value = null;
  const tabItem = getActiveTabItem();
  if (!tabItem || innerTabIndex.value < 0) {
    return;
  }
  const newRdh = tabItem.list[innerTabIndex.value];
  //  refreshable.value = tabItem.refreshable;

  nextTick(() => {
    activeInnerResponse.value = newRdh;
    vscode.postCommand({
      command: "selectInnerTab",
      params: { tabId: tabItem.tabId, innerIndex: innerTabIndex.value },
    });
  });
};

const addTabItem = (tabItem: HttpResponseTabItem) => {
  const idx = tabItems.value.findIndex((it) => it.tabId === tabItem.tabId);
  if (idx < 0) {
    tabItems.value.unshift(tabItem);
  }
  showTab(tabItem.tabId);
};

const removeTabItem = (tabId: string, changeActiveTab = false) => {
  const idx = tabItems.value.findIndex((it) => it.tabId === tabId);
  if (idx >= 0) {
    const item = tabItems.value.splice(idx, 1)[0];
    const action: CloseTabActionCommand = {
      command: "closeTab",
      params: {
        tabId: item.tabId,
      },
    };
    vscode.postCommand(action);
  }

  if (changeActiveTab && tabItems.value.length > 0) {
    showTab(tabItems.value[0].tabId);
  }
};

const setSearchResponse = ({ tabId, value }: { tabId: string; value: NodeRunAxiosResponse[] }) => {
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  tabItem.list.splice(0, tabItem.list.length);
  innerTabItems.value.splice(0, innerTabItems.value.length);
  nextTick(() => {
    tabItem.list.push(...value);
    tabItem.list.forEach((res: NodeRunAxiosResponse, idx) => {
      const label = res.title;
      innerTabItems.value.push({ value: idx, label });
    });
    innerTabIndex.value = tabItem.list.length > 0 ? 0 : -1;

    inProgress.value = false;
    resetactiveInnerResponse();
    setTimeout(resetSpPaneWrapperHeight, 200);
  });
};

function actionToolbar(command: string, inParams?: any) {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }
  const { tabId } = tabItem;
  let action = undefined;
  switch (command) {
    case "refresh":
      action = {
        command,
        params: {
          tabId,
        },
      };
      inProgress.value = true;
      break;
    case "output":
      output(inParams);
      return;
    default:
      console.error("command naiyo");
      return;
  }

  vscode.postCommand(action);
}

const output = (params: Omit<OutputParams, "tabId">): void => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  vscode.postCommand({
    command: "output",
    params: {
      tabId: tabItem.tabId,
      ...params,
    },
  });
};

const writeToClipboard = (params: Omit<WriteToClipboardParams, "tabId">): void => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  vscode.postCommand({
    command: "writeToClipboard",
    params: {
      tabId: tabItem.tabId,
      ...params,
    },
  });
};

const recieveMessage = (data: HttpResponsesPanelEventData) => {
  const { command, value } = data;

  switch (command) {
    case "add-tab-item":
      if (value.addTabItem) {
        addTabItem(value.addTabItem);
      }
      break;
    case "set-response":
      if (value.searchResponse === undefined) {
        return;
      }
      setSearchResponse(value.searchResponse);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="HttpResponsesPanel">
    <div v-if="contentMode == 'tab'" class="tab-container-actions">
      <VsCodeDropdown
        v-if="innerTabItems.length > 1"
        v-model="innerTabIndex"
        :items="innerTabItems"
        style="z-index: 15"
        @change="resetactiveInnerResponse"
      />
      <!-- <button
        v-if="refreshable"
        @click="actionToolbar('refresh', {})"
        :disabled="inProgress"
        title="Request again"
      >
        <fa icon="rotate" />
      </button>
      <button
        @click="
          writeToClipboard({
            fileType: 'text',
            outputWithType: 'withComment',
            withRowNo: false,
            withRuleViolation: true,
            withCodeLabel: true,
          })
        "
        :disabled="inProgress"
        title="Write to clipboard"
      >
        <fa icon="clipboard" />
      </button>
      <SecondarySelectionAction
        :items="writeToClipboardDetailItems"
        title="Write to clipboard"
        @onSelect="writeToClipboard"
      />
      <button
        @click="output({ fileType: 'excel', outputWithType: 'withComment' })"
        :disabled="inProgress"
        title="Output as Excel"
      >
        <fa icon="file-excel" />
      </button>
      <SecondarySelectionAction
        :items="outputDetailItems"
        title="Output as Excel"
        @onSelect="(v:any) => output({ fileType: 'excel', outputWithType: v })"
      /> -->
    </div>

    <vscode-panels
      v-if="contentMode == 'tab'"
      class="tab-wrapper"
      :activeid="activeTabId"
      aria-label="With Active Tab"
    >
      <VsCodeTabHeader
        v-for="tabItem in tabItems"
        :id="tabItem.tabId"
        :key="tabItem.tabId"
        :title="`${tabItem.title}`"
        :is-active="isActiveTabId(tabItem.tabId)"
        :closable="true"
        @click="showTab(tabItem.tabId)"
        @close="removeTabItem(tabItem.tabId, true)"
      >
      </VsCodeTabHeader>
      <vscode-panel-view
        v-for="tabItem of tabItems"
        :id="'view-' + tabItem.tabId"
        :key="tabItem.tabId"
      >
        <section :style="{ width: `${splitterWidth}px` }">
          <div v-if="activeInnerResponse" class="spPaneWrapper">
            <HttpResponseViewer
              :res="activeInnerResponse"
              :width="splitterWidth"
              :height="splitterHeight"
            />
          </div>
        </section>
      </vscode-panel-view>
    </vscode-panels>
  </section>
</template>

<style scoped>
section.HttpResponsesPanel {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;
}

vscode-panel-view {
  padding: 4px;
}

.primary {
  color: var(--button-primary-foreground) !important;
  background: var(--button-primary-background) !important;
}

.tab-container-actions {
  position: absolute;
  right: 2px;
  top: 1px;
  display: flex;
  height: 28px;
  border-radius: 1px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 0 8px 0 4px;
  align-items: center;
}
.tab-container-actions > button {
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  color: var(--foreground);
  outline: none;
  font-size: var(--type-ramp-base-font-size);
  fill: currentcolor;
  cursor: pointer;
}

.tab-container-actions > button:hover {
  background-color: var(--vscode-toolbar-hoverBackground);
}
</style>
