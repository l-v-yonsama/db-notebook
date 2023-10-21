<script setup lang="ts">
import { ref, defineExpose, onMounted, nextTick } from "vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import {
  vsCodePanels,
  vsCodePanelView,
  vsCodePanelTab,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";
import RDHViewer from "./RDHViewer.vue";
import type {
  CloseTabActionCommand,
  CompareParams,
  DiffPanelEventData,
  DiffTabInnerItem,
  DiffTabItem,
  OutputParams,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { DropdownItem, SecondaryItem } from "@/types/Components";
import { OUTPUT_DETAIL_ITEMS } from "@/constants";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

const activeTabId = ref("");
const tabItems = ref([] as DiffTabItem[]);
const inProgress = ref(false);
const splitterWidth = ref(300);
const splitterHeight = ref(300);
const innerTabIndex = ref(-1);
const innerTabVisible = ref(false);
const innerTabItems = ref([] as DropdownItem[]);
const activeInnerRdh1 = ref(null as any);
const activeInnerRdh2 = ref(null as any);
const displayOnlyChanged = ref(false);
const hasUndoChangeSql = ref(false);

const outputDetailItems = OUTPUT_DETAIL_ITEMS;
const compareDetailItems = [
  {
    kind: "selection",
    label: "Compare with before content",
    value: { base: "before" },
  },
  {
    kind: "selection",
    label: "Compare with after content",
    value: { base: "after" },
  },
] as SecondaryItem[];

type MoreOption = {
  displayFilter: "none" | "onlyChanged";
};

const moreDetailItems = [
  {
    kind: "selection",
    label: "Displays all rows",
    value: { displayFilter: "none" },
    when: () => displayOnlyChanged.value,
  },
  {
    kind: "selection",
    label: "Display only the rows that have changed",
    value: { displayFilter: "onlyChanged" },
    when: () => !displayOnlyChanged.value,
  },
] as SecondaryItem<MoreOption>[];

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

function getActiveTabItem(): DiffTabItem | undefined {
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as DiffTabItem;
}

function isActiveTabId(tabId: string): boolean {
  const id = activeTabId.value.substring(4); // 'tab-'
  return tabId === id;
}

const showTab = (tabId: string) => {
  hasUndoChangeSql.value = false;
  activeTabId.value = `tab-${tabId}`;
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  hasUndoChangeSql.value = tabItem.hasUndoChangeSql;
  innerTabItems.value.splice(0, innerTabItems.value.length);
  innerTabVisible.value = false;
  tabItem.list.forEach((item: DiffTabInnerItem, idx) => {
    const { type } = item.rdh1.meta;
    const sqlType = (type ?? "").substring(0, 3).trim().toUpperCase();
    const label = `${idx + 1}:${sqlType}: ${item.title}`;
    innerTabItems.value.push({ value: idx, label });
  });
  innerTabIndex.value = tabItem.list.length > 0 ? 0 : -1;
  nextTick(() => {
    innerTabVisible.value = tabItem.list.length > 0;
    resetActiveInnerRdh();
  });
  vscode.postCommand({ command: "selectTab", params: { tabId } });
};

const resetActiveInnerRdh = () => {
  activeInnerRdh1.value = null;
  activeInnerRdh2.value = null;
  const tabItem = getActiveTabItem();
  if (!tabItem || innerTabIndex.value < 0) {
    return;
  }
  nextTick(() => {
    activeInnerRdh1.value = tabItem.list[innerTabIndex.value].rdh1;
    activeInnerRdh2.value = tabItem.list[innerTabIndex.value].rdh2;
    vscode.postCommand({
      command: "selectInnerTab",
      params: { tabId: tabItem.tabId, innerIndex: innerTabIndex.value },
    });
  });
};

const addTabItem = (tabItem: DiffTabItem) => {
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

const setSearchResult = ({ tabId, value }: { tabId: string; value: DiffTabItem }) => {
  const idx = tabItems.value.findIndex((it) => it.tabId === tabId);
  if (idx < 0) {
    return;
  }
  tabItems.value.splice(idx, 1);
  nextTick(() => {
    addTabItem(value);
  });
};

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
      displayOnlyChanged: displayOnlyChanged.value,
      ...params,
    },
  });
};

const createUndoChangeSql = (): void => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  vscode.postCommand({
    command: "createUndoChangeSql",
    params: {
      tabId: tabItem.tabId,
    },
  });
};

const selectedMoreOptions = (v: MoreOption): void => {
  displayOnlyChanged.value = v.displayFilter == "onlyChanged";
  resetActiveInnerRdh();
};

const recieveMessage = (data: DiffPanelEventData) => {
  const { command, value } = data;

  switch (command) {
    case "add-tab-item":
      if (value.addTabItem === undefined) {
        return;
      }
      addTabItem(value.addTabItem);
      break;
    case "set-search-result":
      if (value.searchResult === undefined) {
        return;
      }
      setSearchResult(value.searchResult);
      break;
  }
};

defineExpose({
  recieveMessage,
  removeTabItem,
});
</script>

<template>
  <section class="MdhPanel">
    <div class="tab-container-actions">
      <VsCodeDropdown
        v-if="innerTabVisible"
        v-model="innerTabIndex"
        :items="innerTabItems"
        style="z-index: 15"
        @change="resetActiveInnerRdh"
      ></VsCodeDropdown>
      <button
        @click="compare({ base: 'before' })"
        :disabled="inProgress"
        title="Compare with before content"
      >
        <fa icon="code-compare" />
      </button>
      <SecondarySelectionAction :items="compareDetailItems" title="Compare" @onSelect="compare" />
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
      <button
        :disabled="!hasUndoChangeSql"
        @click="createUndoChangeSql"
        title="Create undo change sql"
      >
        <fa icon="rotate-left" />
      </button>
      <SecondarySelectionAction
        :items="moreDetailItems"
        title="more"
        @onSelect="selectedMoreOptions"
      />
    </div>
    <vscode-panels class="tab-wrapper" :activeid="activeTabId" aria-label="With Active Tab">
      <VsCodeTabHeader
        v-for="tabItem in tabItems"
        :id="tabItem.tabId"
        :key="tabItem.tabId"
        :title="`${tabItem.title}(${tabItem.subTitle})`"
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
          <splitpanes
            class="default-theme"
            :style="{ 'max-width': `${splitterWidth}px`, 'height': `${splitterHeight}px` }"
          >
            <pane min-size="5">
              <div v-if="activeInnerRdh1" class="spPaneWrapper">
                <RDHViewer
                  :rdh="activeInnerRdh1"
                  :width="splitterWidth"
                  :height="splitterHeight"
                  :readonly="true"
                  :showOnlyChanged="displayOnlyChanged"
                >
                </RDHViewer>
              </div>
            </pane>
            <pane min-size="5">
              <div v-if="activeInnerRdh2" class="spPaneWrapper">
                <RDHViewer
                  :rdh="activeInnerRdh2"
                  :width="splitterWidth"
                  :height="splitterHeight"
                  :readonly="true"
                  :showOnlyChanged="displayOnlyChanged"
                >
                </RDHViewer>
              </div>
            </pane>
          </splitpanes>
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
