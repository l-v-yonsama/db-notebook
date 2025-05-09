<script setup lang="ts">
import { WRITE_TO_CLIP_BOARD_DETAIL_ITEMS } from "@/constants";
import type { DropdownItem, SecondaryItem } from "@/types/Components";
import type {
  CloseTabActionCommand,
  CompareParams,
  MdhViewEventData,
  OutputParams,
  RdhTabItem,
  WriteToClipboardParams,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { isNumericLike, sleep, type ResultSetData } from "@l-v-yonsama/rdh";
import {
  provideVSCodeDesignSystem,
  vsCodePanels,
  vsCodePanelTab,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import { defineExpose, nextTick, onMounted, ref } from "vue";
import CompareKeySettings from "../CompareKeySettings.vue";
import RDHViewer from "../RDHViewer.vue";
import SecondarySelectionAction from "../base/SecondarySelectionAction.vue";
import VsCodeDropdown from "../base/VsCodeDropdown.vue";
import VsCodeTabHeader from "../base/VsCodeTabHeader.vue";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

const activeTabId = ref("");
const tabItems = ref([] as RdhTabItem[]);
const inProgress = ref(false);
const splitterWidth = ref(300);
const splitterHeight = ref(300);
const innerTabIndex = ref(-1);
const innerTabItems = ref([] as DropdownItem[]);
const activeInnerRdh = ref(null as any);
const numOfRows = ref(0);
const contentMode = ref("tab" as "tab" | "keys");
const noCompareKeys = ref(false);
const activeTabRdhList = ref([] as ResultSetData[]);
const initialized = ref(false);

// secondarySelections
const writeToClipboardDetailItems = WRITE_TO_CLIP_BOARD_DETAIL_ITEMS;

type CompareMoreOption = {
  command: "compare" | "editCompareKeys";
};
const compareDetailItems = [
  {
    kind: "selection",
    label: "Compare current contets with these",
    value: { command: "compare" },
  },
  {
    kind: "divider",
  },
  {
    kind: "selection",
    label: "Edit compare keys",
    value: { command: "editCompareKeys" },
  },
] as SecondaryItem<CompareMoreOption>[];

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.MdhView");
  //351 => 272
  // multi 420 => 236px ... 184
  if (sectionWrapper?.clientHeight) {
    splitterHeight.value = sectionWrapper?.clientHeight - 41;
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = sectionWrapper.clientWidth - 14;
  }
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
});

const rdhViewerRef = ref<InstanceType<typeof RDHViewer>>();
const setRdhViewerRef = (el: any) => {
  rdhViewerRef.value = el;
};

const editable = ref(true);
const refreshable = ref(false);
const describable = ref(false);

function getActiveTabItem(): RdhTabItem | undefined {
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as RdhTabItem;
}

function isActiveTabId(tabId: string): boolean {
  const id = activeTabId.value.substring(4); // 'tab-'
  return tabId === id;
}

const showTab = async (tabId: string, innerIndex?: number) => {
  activeTabId.value = `tab-${tabId}`;
  await nextTick();

  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }

  if (innerIndex === undefined) {
    innerTabIndex.value = tabItem.list.length > 0 ? 0 : -1;
  } else {
    if (innerIndex > tabItem.list.length - 1 || innerIndex < 0) {
      innerTabIndex.value = tabItem.list.length > 0 ? 0 : -1;
    } else {
      innerTabIndex.value = tabItem.list.length > 0 ? innerIndex : -1;
    }
  }

  innerTabItems.value.splice(0, innerTabItems.value.length);
  activeTabRdhList.value.splice(0, activeTabRdhList.value.length);

  await nextTick();

  tabItem.list.forEach((rdh: ResultSetData, idx: number) => {
    const { tableName, type } = rdh.meta;
    const sqlType = (type ?? "").substring(0, 3).trim().toUpperCase();
    const label = `${idx + 1}:${sqlType}: ${tableName}`;
    innerTabItems.value.push({ value: idx, label });
    activeTabRdhList.value.push(rdh);
  });

  vscode.postCommand({ command: "selectTab", params: { tabId } });
  resetActiveInnerRdh();
};

const resetActiveInnerRdh = async () => {
  editable.value = false;
  refreshable.value = false;
  noCompareKeys.value = true;
  activeInnerRdh.value = null;

  const tabItem = getActiveTabItem();
  if (!tabItem || innerTabIndex.value < 0) {
    numOfRows.value = 0;
    return;
  }

  const newRdh = tabItem.list[innerTabIndex.value];
  numOfRows.value = newRdh.rows.length;
  await sleep(100);

  editable.value = newRdh.meta?.editable === true;
  refreshable.value = tabItem.refreshable;
  describable.value =
    newRdh.keys.some((it) => isNumericLike(it.type)) && tabItem.title != "Statistics";

  await nextTick();

  noCompareKeys.value = (newRdh.meta?.compareKeys?.length ?? 0) === 0;
  activeInnerRdh.value = newRdh;
  vscode.postCommand({
    command: "selectInnerTab",
    params: { tabId: tabItem.tabId, innerIndex: innerTabIndex.value },
  });
};

const initialize = async (params: MdhViewEventData["value"]["initialize"]) => {
  initialized.value = false;
  tabItems.value.splice(0, tabItems.value.length);
  await nextTick();

  params?.tabItems.forEach((it) => tabItems.value.unshift(it));
  if (params?.currentTabId) {
    await showTab(params?.currentTabId, params?.currentInnerIndex);
  }
  initialized.value = true;
};

const addTabItem = async (tabItem: RdhTabItem) => {
  const idx = tabItems.value.findIndex((it) => it.tabId === tabItem.tabId);
  if (idx < 0) {
    initialized.value = false;
    await sleep(200);
    tabItems.value.unshift(tabItem);
  }
  await nextTick();

  await showTab(tabItem.tabId);
  initialized.value = true;
};

const removeTabItem = async (tabId: string, changeActiveTab = false) => {
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
  await nextTick();

  if (changeActiveTab && tabItems.value.length > 0) {
    await showTab(tabItems.value[0].tabId);
  }
};

const setSearchResult = async ({ tabId, value }: { tabId: string; value: ResultSetData[] }) => {
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  initialized.value = false;
  await sleep(200);
  tabItem.list.splice(0, tabItem.list.length);
  await nextTick();
  tabItem.list.push(...value);
  await nextTick();

  await showTab(tabId);
  initialized.value = true;
  inProgress.value = false;
  setTimeout(resetSpPaneWrapperHeight, 200);
};

function actionToolbar(command: string, inParams?: any) {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }
  const { tabId } = tabItem;
  let action = undefined;
  switch (command) {
    case "compare":
      compare(inParams);
      return;
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
    case "describe":
      action = {
        command,
        params: { tabId: tabItem.tabId, innerIndex: innerTabIndex.value },
      };
      break;
    default:
      console.error("command naiyo");
      return;
  }

  vscode.postCommand(action);
}

const compare = (params: Omit<CompareParams, "tabId">): void => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  vscode.postCommand({
    command: "compare",
    params: {
      tabId: tabItem.tabId,
      ...params,
    },
  });
};
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

const selectedCompareMoreOptions = (v: CompareMoreOption): void => {
  const { command } = v;
  switch (command) {
    case "compare": {
      compare({});
      return;
    }
    case "editCompareKeys": {
      contentMode.value = "keys";
      return;
    }
  }
};

const saveCompareKeys = (
  values: {
    index: number;
    compareKeyNames: string[];
  }[]
): void => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  vscode.postCommand({
    command: "saveCompareKeys",
    params: {
      tabId: tabItem.tabId,
      list: values,
    },
  });
  contentMode.value = "tab";
};

const recieveMessage = (data: MdhViewEventData) => {
  const { command, value } = data;

  switch (command) {
    case "add-tab-item":
      if (value.addTabItem) {
        addTabItem(value.addTabItem);
      }
      break;
    case "set-search-result":
      if (value.searchResult === undefined) {
        return;
      }
      setSearchResult(value.searchResult);
      break;
    case "initialize":
      initialize(value.initialize);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="MdhView">
    <section v-if="!initialized" class="centered-content">Just a moment, please.</section>
    <template v-else>

      <div v-if="contentMode == 'tab'" class="tab-container-actions">
        <VsCodeDropdown v-if="innerTabItems.length > 1" v-model="innerTabIndex" :items="innerTabItems"
          style="z-index: 15" @change="resetActiveInnerRdh" />

        <button v-if="!editable && refreshable" @click="actionToolbar('compare', {})"
          :disabled="inProgress || noCompareKeys"
          :title="noCompareKeys ? 'No compare keys(Primary, Unique)' : 'Compare with current content'">
          <fa icon="code-compare" />
        </button>
        <SecondarySelectionAction v-if="!editable && refreshable" :items="compareDetailItems" title="Compare"
          @onSelect="selectedCompareMoreOptions" />
        <button v-if="refreshable" @click="actionToolbar('refresh', {})" :disabled="inProgress" title="Search again">
          <fa icon="rotate" />
        </button>
        <button @click="
          writeToClipboard({
            fileType: 'text',
          })
          " :disabled="inProgress" title="Copy to clipboard">
          <fa icon="clipboard" />
        </button>
        <SecondarySelectionAction :items="writeToClipboardDetailItems" title="Copy to clipboard"
          @onSelect="writeToClipboard" />
        <button @click="output({ fileType: 'html' })" :disabled="inProgress" title="Output as HTML">
          <fa icon="file-lines" />
        </button>
        <button @click="output({ fileType: 'excel' })" :disabled="inProgress" title="Output as Excel">
          <fa icon="file-excel" />
        </button>
        <button v-if="describable" @click="actionToolbar('describe', {})" :disabled="inProgress"
          title="Generate descriptive statistics">
          <fa icon="magnifying-glass-chart" />
        </button>
      </div>
      <CompareKeySettings v-if="contentMode == 'keys'" :rdhList="activeTabRdhList" @cancel="contentMode = 'tab'"
        @save="saveCompareKeys" />
      <vscode-panels v-if="contentMode == 'tab'" class="tab-wrapper" :activeid="activeTabId"
        aria-label="With Active Tab">
        <VsCodeTabHeader v-for="tabItem in tabItems" :id="tabItem.tabId" :key="tabItem.tabId"
          :title="`${tabItem.title}`" :is-active="isActiveTabId(tabItem.tabId)" :closable="true"
          @click="showTab(tabItem.tabId)" @close="removeTabItem(tabItem.tabId, true)">
        </VsCodeTabHeader>
        <vscode-panel-view v-for="tabItem of tabItems" :id="'view-' + tabItem.tabId" :key="tabItem.tabId">
          <section :style="{ width: `${splitterWidth}px` }">
            <div v-if="activeInnerRdh && isActiveTabId(tabItem.tabId)" class="spPaneWrapper">
              <RDHViewer :rdh="activeInnerRdh" :config="tabItem.config" :width="splitterWidth" :height="splitterHeight"
                :ref="setRdhViewerRef" />
            </div>
            <div v-else class="centered-content">Drawing {{ numOfRows.toLocaleString() }} rows now. Just a moment,
              please.</div>
          </section>
        </vscode-panel-view>
      </vscode-panels>
    </template>
  </section>
</template>

<style scoped>
section.MdhView {
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
</style>
