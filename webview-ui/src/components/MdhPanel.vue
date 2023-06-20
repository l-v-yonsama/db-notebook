<script setup lang="ts">
import { ref, defineExpose, onMounted, nextTick } from "vue";
import CompareKeySettings from "./CompareKeySettings.vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import {
  vsCodePanels,
  vsCodePanelView,
  vsCodePanelTab,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";
import type { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import RDHViewer from "./RDHViewer.vue";
import type {
  CloseTabActionCommand,
  CompareParams,
  OutputParams,
  WriteToClipboardParams,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { DropdownItem, SecondaryItem } from "@/types/Components";
import { OUTPUT_DETAIL_ITEMS, WRITE_TO_CLIP_BOARD_DETAIL_ITEMS } from "@/constants";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

type RdhTabItem = {
  tabId: string;
  title: string;
  list: ResultSetData[];
};

const activeTabId = ref("");
const tabItems = ref([] as RdhTabItem[]);
const inProgress = ref(false);
const splitterWidth = ref(300);
const splitterHeight = ref(300);
const innerTabIndex = ref(-1);
const innerTabItems = ref([] as DropdownItem[]);
const activeInnerRdh = ref(null as any);
const contentMode = ref("tab" as "tab" | "keys");
const noCompareKeys = ref(false);
const activeTabRdhList = ref([] as ResultSetData[]);

// secondarySelections
const outputDetailItems = OUTPUT_DETAIL_ITEMS;
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
  const sectionWrapper = window.document.querySelector("section.MdhPanel");
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

function getActiveTabItem(): RdhTabItem | undefined {
  console.log("getActiveTabItem:", activeTabId.value);
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as RdhTabItem;
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
  activeTabRdhList.value.splice(0, activeTabRdhList.value.length);
  tabItem.list.forEach((rdh: ResultSetData, idx) => {
    const { tableName, type } = rdh.meta;
    const sqlType = (type ?? "").substring(0, 3).trim().toUpperCase();
    const label = `${idx + 1}:${sqlType}: ${tableName}`;
    innerTabItems.value.push({ value: idx, label });
    activeTabRdhList.value.push(rdh);
  });
  innerTabIndex.value = tabItem.list.length > 0 ? 0 : -1;
  resetActiveInnerRdh();
  vscode.postCommand({ command: "selectTab", params: { tabId } });
};

const resetActiveInnerRdh = () => {
  noCompareKeys.value = true;
  activeInnerRdh.value = null;
  const tabItem = getActiveTabItem();
  if (!tabItem || innerTabIndex.value < 0) {
    return;
  }
  const newRdh = tabItem.list[innerTabIndex.value];
  console.log("innerTabIndex.value", innerTabIndex.value);
  console.log("newRdh", newRdh);

  nextTick(() => {
    noCompareKeys.value = (newRdh.meta?.compareKeys?.length ?? 0) === 0;
    activeInnerRdh.value = newRdh;
    vscode.postCommand({
      command: "selectInnerTab",
      params: { tabId: tabItem.tabId, innerIndex: innerTabIndex.value },
    });
  });
};

const addTabItem = (tabItem: RdhTabItem) => {
  const idx = tabItems.value.findIndex((it) => it.tabId === tabItem.tabId);
  console.log("addTabItem ", tabItem, idx);
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

const setSearchResult = ({ tabId, value }: { tabId: string; value: ResultSetData[] }) => {
  console.log("tabId", tabId);
  console.log("value", value);
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  tabItem.list.splice(0, tabItem.list.length);
  innerTabItems.value.splice(0, innerTabItems.value.length);
  nextTick(() => {
    tabItem.list.push(...value);
    tabItem.list.forEach((rdh: ResultSetData, idx) => {
      const { tableName, type } = rdh.meta;
      const sqlType = (type ?? "").substring(0, 3).trim().toUpperCase();
      const label = `${idx + 1}:${sqlType}: ${tableName}`;
      innerTabItems.value.push({ value: idx, label });
    });
    innerTabIndex.value = tabItem.list.length > 0 ? 0 : -1;

    inProgress.value = false;
    resetActiveInnerRdh();
    setTimeout(resetSpPaneWrapperHeight, 200);
  });
};

function actionToolbar(command: string, inParams?: any) {
  console.log("called actionToolbar command", command, " inParams", inParams);
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    console.error("tab item naiyo");
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
  console.log(v);
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
  console.log("called saveCompareKeys");
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }
  console.log("tabItem tabItem", tabItem);

  vscode.postCommand({
    command: "saveCompareKeys",
    params: {
      tabId: tabItem.tabId,
      list: values,
    },
  });
  contentMode.value = "tab";
};

defineExpose({
  addTabItem,
  removeTabItem,
  setSearchResult,
});
</script>

<template>
  <section class="MdhPanel">
    <div v-if="contentMode == 'tab'" class="tab-container-actions">
      <VsCodeDropdown
        v-if="innerTabItems.length > 1"
        v-model="innerTabIndex"
        :items="innerTabItems"
        style="z-index: 15"
        @change="resetActiveInnerRdh"
      />
      <button
        @click="actionToolbar('compare', {})"
        :disabled="inProgress || noCompareKeys"
        :title="noCompareKeys ? 'No compare keys(Primary, Unique)' : 'Compare with current content'"
      >
        <fa icon="code-compare" />
      </button>
      <SecondarySelectionAction
        :items="compareDetailItems"
        title="Compare"
        @onSelect="selectedCompareMoreOptions"
      />
      <button @click="actionToolbar('refresh', {})" :disabled="inProgress" title="Search again">
        <fa icon="rotate" />
      </button>
      <button
        @click="
          writeToClipboard({
            fileType: 'text',
            outputWithType: 'withComment',
            withRowNo: true,
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
      />
    </div>
    <CompareKeySettings
      v-if="contentMode == 'keys'"
      :rdhList="activeTabRdhList"
      @cancel="contentMode = 'tab'"
      @save="saveCompareKeys"
    />
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
          <div v-if="activeInnerRdh" class="spPaneWrapper">
            <RDHViewer
              :rdh="activeInnerRdh"
              :width="splitterWidth"
              :height="splitterHeight"
              :readonly="true"
            />
          </div>
        </section>
      </vscode-panel-view>
    </vscode-panels>
  </section>
</template>

<style scoped>
section.MdhPanel {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;
}

vscode-panel-view {
  padding: 4px;
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
