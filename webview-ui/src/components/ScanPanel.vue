<script setup lang="ts">
import type { SecondaryItem } from "@/types/Components";
import type { CellFocusParams } from "@/types/RdhEvents";
import type {
  CloseScanPanelActionCommand,
  DeleteKeyActionCommand,
  OpenScanPanelActionCommand,
  OutputParams,
  ScanConditionItem,
  ScanPanelEventData,
  ScanTabItem,
  SearchScanPanelActionCommand,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { ResourceType } from "@l-v-yonsama/multi-platform-database-drivers";
import type { ResultSetData } from "@l-v-yonsama/rdh";
import {
  provideVSCodeDesignSystem,
  vsCodeCheckbox,
  vsCodePanels,
  vsCodePanelTab,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import dayjs from "dayjs";
import { computed, nextTick, onMounted, ref } from "vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import VsCodeTextArea from "./base/VsCodeTextArea.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import RDHViewer from "./RDHViewer.vue";

provideVSCodeDesignSystem().register(
  vsCodeCheckbox(),
  vsCodePanels(),
  vsCodePanelView(),
  vsCodePanelTab()
);

const outputDetailItems = ref([
  {
    kind: "selection",
    label: "Output excel (no type, comment)",
    value: "none",
  },
  {
    kind: "selection",
    label: "Output excel (with type)",
    value: "withType",
  },
  {
    kind: "selection",
    label: "Output excel (with comment)",
    value: "withComment",
  },
  {
    kind: "selection",
    label: "Output excel (with type, comment)",
    value: "both",
  },
] as SecondaryItem[]);

const activeTabId = ref("");
const tabItems = ref([] as ScanTabItem[]);
const inProgress = ref(false);
const isMultiLineKeyword = ref(false);
const splitterWidth = ref(300);
const splitterHeight = ref(300);
const openLogStreamParams = ref({
  visible: false,
  canAction: false,
  parentTabId: "",
  logGroupName: "",
  logStream: "",
  startTime: "",
});
const deleteKeyParams = ref({
  visible: false,
  canAction: false,
  tabId: "",
  key: "",
});

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.ScanPanel");
  //351 => 272
  // multi 420 => 236px ... 184
  if (sectionWrapper?.clientHeight) {
    if (getActiveTabItem()?.multilineKeyword) {
      splitterHeight.value = Math.max(sectionWrapper?.clientHeight - 192, 10);
    } else {
      splitterHeight.value = Math.max(sectionWrapper?.clientHeight - 89, 10);
    }
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

function getActiveTabItem(): ScanTabItem | undefined {
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as ScanTabItem;
}

function isActiveTabId(tabId: string): boolean {
  const id = activeTabId.value.substring(4); // 'tab-'
  return tabId === id;
}

// startDt: 表示される日付はユーザーのブラウザーに設定されたロケールに基づいた書式
// 解釈される value は常に yyyy-mm-dd の書式
function search() {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }
  inProgress.value = true;
  const { tabId, limit, jsonExpansion, keyword, startDt, endDt } = tabItem;

  let resourceType = tabItem.resourceType.value;
  if (tabItem.resourceType.visible) {
    resourceType = tabItem.resourceType.value;
  }

  const action: SearchScanPanelActionCommand = {
    command: "search",
    params: {
      tabId,
      limit: limit.visible ? toNum(limit.value) : undefined,
      jsonExpansion: jsonExpansion.visible ? jsonExpansion.value === true : undefined,
      keyword: keyword.visible ? keyword.value : undefined,
      startTime: toIso8601String(startDt, true),
      endTime: toIso8601String(endDt, false),
      resourceType,
    },
  };
  vscode.postCommand(action);
}

const toNum = (s: string): number | undefined => {
  if (s == null || s === "") {
    return undefined;
  }
  const n = Number(s);
  if (isNaN(n)) {
    return undefined;
  }
  return n;
};

const toIso8601String = (item: ScanConditionItem, isStart: boolean): string | undefined => {
  if (!item.visible || item.value === undefined || item.value === null || item.value === "") {
    return undefined;
  }
  const d = isStart
    ? dayjs(item.value).hour(0).minute(0).second(0).millisecond(0)
    : dayjs(item.value).hour(23).minute(59).second(59).millisecond(999);

  return d.toISOString();
};

const showTab = async (tabId: string) => {
  activeTabId.value = `tab-${tabId}`;
  await nextTick();

  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  isMultiLineKeyword.value = tabItem.multilineKeyword === true;
  openLogStreamParams.value.visible = isMultiLineKeyword.value;
  deleteKeyParams.value.visible = false;
  if (tabItem.dbType === "Redis") {
    deleteKeyParams.value.visible = true;
  }
  vscode.postCommand({ command: "selectTab", params: { tabId } });
};

const addTabItem = async (tabItem: ScanTabItem) => {
  const idx = tabItems.value.findIndex((it) => it.tabId === tabItem.tabId);
  if (idx < 0) {
    tabItems.value.unshift(tabItem);
  }
  await nextTick();
  showTab(tabItem.tabId);
};

const removeTabItem = (tabId: string, changeActiveTab = false) => {
  const idx = tabItems.value.findIndex((it) => it.tabId === tabId);
  if (idx >= 0) {
    const item = tabItems.value.splice(idx, 1)[0];
    const action: CloseScanPanelActionCommand = {
      command: "closeScanPanel",
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

const setSearchResult = ({
  tabId,
  value,
  resourceType,
}: {
  tabId: string;
  value: ResultSetData;
  resourceType: ResourceType;
}) => {
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  tabItem.rdh = undefined;
  tabItem.prevResourceTypeValue = resourceType;

  nextTick(() => {
    tabItem.rdh = value;
    inProgress.value = false;
    setTimeout(resetSpPaneWrapperHeight, 200);
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

const onClickCell = (params: CellFocusParams): void => {
  openLogStreamParams.value.canAction = false;
  deleteKeyParams.value.canAction = false;
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }
  const logGroupName = tabItem.title;
  switch (tabItem.rootRes["resourceType"]) {
    case "RedisDatabase":
      {
        const key = params.rowValues["key"];
        deleteKeyParams.value.tabId = tabItem.tabId;
        deleteKeyParams.value.canAction = true;
        deleteKeyParams.value.key = key;
      }
      break;
    case "LogGroup":
      {
        const logStream = params.rowValues["@logStream"];
        const startTime = params.rowValues["@timestamp"];
        openLogStreamParams.value.parentTabId = tabItem.tabId;
        openLogStreamParams.value.logGroupName = logGroupName;
        openLogStreamParams.value.logStream = logStream;
        openLogStreamParams.value.startTime = startTime;
        openLogStreamParams.value.canAction = true;
      }
      break;
  }
};

const openStream = (): void => {
  const action: OpenScanPanelActionCommand = {
    command: "openScanPanel",
    params: {
      parentTabId: openLogStreamParams.value.parentTabId,
      logGroupName: openLogStreamParams.value.logGroupName,
      logStream: openLogStreamParams.value.logStream,
      startTime: openLogStreamParams.value.startTime,
    },
  };
  vscode.postCommand(action);
};

const deleteKey = (): void => {
  const action: DeleteKeyActionCommand = {
    command: "DeleteKey",
    params: {
      tabId: deleteKeyParams.value.tabId,
      key: deleteKeyParams.value.key,
    },
  };
  deleteKeyParams.value.canAction = false;
  vscode.postCommand(action);
};

const stopProgress = (): void => {
  inProgress.value = false;
};

const recieveMessage = (data: ScanPanelEventData) => {
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
    case "remove-tab-item":
      if (value.removeTabItem === undefined) {
        return;
      }
      removeTabItem(value.removeTabItem.tabId);
      break;
    case "stop-progress":
      stopProgress();
      break;
  }
};

const comparable = computed((): boolean => {
  if (inProgress.value) {
    return false;
  }
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return false;
  }

  if (tabItem.dbType != "Keycloak" && tabItem.dbType != "Auth0") {
    return false;
  }

  let currentResourceType = tabItem.resourceType.value;
  if (tabItem.resourceType.visible && tabItem.prevResourceTypeValue != currentResourceType) {
    return false;
  }

  return true;
});

const compareDetailItems = [
  {
    kind: "selection",
    label: "Search again, Compare current contets with these",
    value: { command: "compare" },
  },
] as SecondaryItem[];

const compare = (): void => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  inProgress.value = true;
  const { tabId, limit, jsonExpansion, keyword, startDt, endDt } = tabItem;

  let resourceType = tabItem.resourceType.value;
  if (tabItem.resourceType.visible) {
    resourceType = tabItem.resourceType.value;
  }

  const action: SearchScanPanelActionCommand = {
    command: "search",
    params: {
      tabId,
      limit: limit.visible ? toNum(limit.value) : undefined,
      jsonExpansion: jsonExpansion.visible ? jsonExpansion.value === true : undefined,
      keyword: keyword.visible ? keyword.value : undefined,
      startTime: toIso8601String(startDt, true),
      endTime: toIso8601String(endDt, false),
      resourceType,
      execComparativeProcess: true,
    },
  };
  vscode.postCommand(action);
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="ScanPanel">
    <div class="tab-container-actions">
      <button @click="output({ fileType: 'excel' })" title="Output as Excel">
        <fa icon="file-excel" />
      </button>
    </div>
    <vscode-panels class="tab-wrapper" :activeid="activeTabId" aria-label="With Active Tab">
      <VsCodeTabHeader v-for="tabItem in tabItems" :id="tabItem.tabId" :key="tabItem.tabId"
        :title="`${tabItem.title}:${tabItem.dbType}`" :is-active="isActiveTabId(tabItem.tabId)" :closable="true"
        @click="showTab(tabItem.tabId)" @close="removeTabItem(tabItem.tabId, true)">
      </VsCodeTabHeader>
      <vscode-panel-view v-for="tabItem of tabItems" :id="'view-' + tabItem.tabId" :key="tabItem.tabId">
        <section v-if="isActiveTabId(tabItem.tabId)" :style="{ width: `${splitterWidth}px` }">
          <div class="toolbar" :style="{ width: `${splitterWidth}px` }">
            <div v-if="isMultiLineKeyword" class="multiple">
              <div class="left">
                <label v-if="tabItem.startDt.visible" for="startTime">{{
                  tabItem.startDt.label
                }}</label>
                <VsCodeTextField v-if="tabItem.startDt.visible" id="startTime" v-model="tabItem.startDt.value"
                  type="date" :title="tabItem.startDt.description"></VsCodeTextField>

                <label v-if="tabItem.endDt.visible" for="endTime">{{ tabItem.endDt.label }}</label>
                <VsCodeTextField v-if="tabItem.endDt.visible" id="endTime" v-model="tabItem.endDt.value" type="date"
                  :title="tabItem.endDt.description"></VsCodeTextField>
                <label v-if="tabItem.limit.visible" for="limit">{{ tabItem.limit.label }}</label>
                <VsCodeTextField v-if="tabItem.limit.visible" id="limit" style="width: 125px"
                  v-model="tabItem.limit.value" type="number" :min="0" :size="9" :title="tabItem.limit.description">
                </VsCodeTextField>
              </div>
              <div class="right">
                <label v-if="tabItem.keyword.visible" for="keyword">{{
                  tabItem.keyword.label
                }}</label>
                <VsCodeTextArea v-if="tabItem.keyword.visible" id="keyword" v-model="tabItem.keyword.value"
                  :maxlength="512" :rows="6" :title="tabItem.keyword.description" placeholder="Enter a keyword"
                  style="height: 97%">
                </VsCodeTextArea>

                <VsCodeButton v-show="openLogStreamParams.visible" appearance="secondary" class="openStream"
                  @click="openStream" :disabled="inProgress || !openLogStreamParams.canAction" title="Open logStream">
                  <span class="codicon codicon-link-external"></span>Open logStream
                </VsCodeButton>

                <VsCodeButton class="search" @click="search" :disabled="inProgress" title="scan">
                  <span class="codicon codicon-search"></span>Search
                </VsCodeButton>
              </div>
            </div>
            <div v-else class="single">
              <VsCodeButton v-show="deleteKeyParams.visible" appearance="secondary" class="deleteKey" @click="deleteKey"
                :disabled="inProgress || !deleteKeyParams.canAction" title="Delete a key">
                <span class="codicon codicon-trash"></span>Delete key
              </VsCodeButton>

              <label v-if="tabItem.resourceType.visible" for="resource-type">Resource</label>
              <VsCodeRadioGroupVue v-if="tabItem.resourceType.visible" id="resource-type"
                v-model="tabItem.resourceType.value" :items="tabItem.resourceType.items" style="z-index: 15" />

              <label v-if="tabItem.startDt.visible" for="startTime">{{
                tabItem.startDt.label
              }}</label>
              <VsCodeTextField v-if="tabItem.startDt.visible" id="startTime" v-model="tabItem.startDt.value" type="date"
                :title="tabItem.startDt.description"></VsCodeTextField>
              <label v-if="tabItem.endDt.visible" for="endTime">{{ tabItem.endDt.label }}</label>
              <VsCodeTextField v-if="tabItem.endDt.visible" id="endTime" v-model="tabItem.endDt.value" type="date"
                :title="tabItem.endDt.description"></VsCodeTextField>
              <label v-if="tabItem.limit.visible" for="limit">{{ tabItem.limit.label }}</label>
              <VsCodeTextField v-if="tabItem.limit.visible" id="limit" class="limit" v-model="tabItem.limit.value"
                type="number" :min="0" :size="9" :title="tabItem.limit.description"></VsCodeTextField>
              <vscode-checkbox v-if="tabItem.jsonExpansion.visible" :checked="tabItem.jsonExpansion.value === true"
                @change="($e: any) => tabItem.jsonExpansion.value = ($e.target.checked == true)"
                style="margin-right: auto">JSON expansion</vscode-checkbox>
              <label v-if="tabItem.keyword.visible" for="keyword">{{ tabItem.keyword.label }}</label>
              <VsCodeTextField v-if="tabItem.keyword.visible" id="keyword" v-model="tabItem.keyword.value"
                :maxlength="128" :title="tabItem.keyword.description" placeholder="Enter a keyword"
                style="max-width: 120px">
              </VsCodeTextField>
              <VsCodeButton @click="search" :disabled="inProgress" title="scan">
                <fa icon="search" />Search
              </VsCodeButton>
              <SecondarySelectionAction :items="compareDetailItems" :disabled="!comparable" title="Compare"
                @onSelect="(v: any) => compare()" />
            </div>
          </div>
          <div class="spPaneWrapper">
            <RDHViewer v-if="tabItem.rdh != undefined" :rdh="tabItem.rdh" :width="splitterWidth"
              :height="splitterHeight" @onClickCell="onClickCell" />
          </div>
        </section>
      </vscode-panel-view>
    </vscode-panels>
  </section>
</template>

<style lang="scss" scoped>
section.ScanPanel {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;
}

vscode-panel-view {
  padding: 7px 4px;
}

.toolbar {
  .single {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    column-gap: 5px;
    margin-bottom: 2px;

    .limit {
      max-width: 100px;
    }
  }

  .multiple {
    display: flex;
    column-gap: 2px;
    flex-grow: 1;

    .left {
      display: flex;
      flex-direction: column;
      align-items: start;
      justify-content: flex-end;
      column-gap: 5px;
      margin-bottom: 2px;
    }

    .right {
      display: flex;
      flex-grow: 1;
      flex-direction: column;

      &>.openStream {
        position: absolute;
        right: 92px;
        top: -1px;
      }

      &>.search {
        position: absolute;
        right: 6px;
        top: -1px;
      }
    }
  }
}
</style>
