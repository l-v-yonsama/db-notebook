<script setup lang="ts">
import { ref, defineExpose, onMounted, nextTick } from "vue";
import dayjs from "dayjs";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextArea from "./base/VsCodeTextArea.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import SecondarySelectionAction from "./base/SecondarySelectionAction.vue";
import {
  vsCodePanels,
  vsCodePanelView,
  vsCodePanelTab,
  provideVSCodeDesignSystem,
} from "@vscode/webview-ui-toolkit";
import type { DBType } from "@/types/lib/DBType";
import type { ResultSetDataHolder } from "@/types/lib/ResultSetDataHolder";
import RDHViewer from "./RDHViewer.vue";
import type { DbResource } from "@/types/lib/DbResource";
import type {
  CloseScanPanelActionCommand,
  OpenScanPanelActionCommand,
  OutputActionCommand,
  OutputParams,
  SearchScanPanelActionCommand,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { CellFocusParams } from "@/types/RdhEvents";
import type { SecondaryItem } from "@/types/Components";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

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

type Props = {
  opt: {
    dbType: string;
  };
};

const props = defineProps<Props>();

type ConditionItem = {
  label: string;
  value: any;
  visible: boolean;
  description?: string;
};

type TabItem = {
  tabId: string;
  conName: string;
  rootRes: DbResource;
  title: string;
  dbType: DBType;
  rdh: any;
  limit: ConditionItem;
  keyword: ConditionItem;
  startTime: ConditionItem;
  endTime: ConditionItem;
  multilineKeyword: boolean;
  parentTarget?: string;
};

const activeTabId = ref("");
const tabItems = ref([] as TabItem[]);
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

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.ScanPanel");
  //351 => 272
  // multi 420 => 236px ... 184
  if (sectionWrapper?.clientHeight) {
    if (getActiveTabItem()?.multilineKeyword) {
      splitterHeight.value = sectionWrapper?.clientHeight - 183;
    } else {
      splitterHeight.value = sectionWrapper?.clientHeight - 80;
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

function getActiveTabItem(): TabItem | undefined {
  console.log("getActiveTabItem:", activeTabId.value);
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as TabItem;
}

function isActiveTabId(tabId: string): boolean {
  const id = activeTabId.value.substring(4); // 'tab-'
  return tabId === id;
}

function search() {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }
  inProgress.value = true;
  const { tabId, limit, keyword, startTime, endTime } = tabItem;

  const action: SearchScanPanelActionCommand = {
    command: "search",
    params: {
      tabId,
      limit: limit.visible ? toNum(limit.value) : undefined,
      keyword: keyword.visible ? keyword.value : undefined,
      startTime: toIso8601String(startTime),
      endTime: toIso8601String(endTime),
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

const toIso8601String = (item: ConditionItem): string | undefined => {
  if (!item.visible) {
    return undefined;
  }
  return dayjs(
    item.value?.replace(/([0-9]+-[0-9]+-[0-9]+)[T ]([0-9]+:[0-9]+:[0-9]+(\.[0-9]+)?)/, "$1T$2")
  ).toISOString();
};

const showTab = (tabId: string) => {
  console.log("at:showTab tabId", tabId);
  activeTabId.value = `tab-${tabId}`;
  console.log("at:showTab reset activeTabId.value", activeTabId.value);
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  console.log("at:showTab tabItem", tabItem);
  if (!tabItem) {
    console.log("at:showTab nothing... tabItems", tabItems.value);
    return;
  }
  console.log("showTab activeTabId.value", activeTabId.value);
  isMultiLineKeyword.value = tabItem.multilineKeyword === true;
  openLogStreamParams.value.visible = isMultiLineKeyword.value;
};

const addTabItem = (tabItem: TabItem) => {
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

const setSearchResult = ({ tabId, value }: { tabId: string; value: ResultSetDataHolder }) => {
  console.log("tabId", tabId);
  console.log("value", value);
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  tabItem.rdh = undefined;
  nextTick(() => {
    tabItem.rdh = value;
    inProgress.value = false;
    setTimeout(resetSpPaneWrapperHeight, 200);
  });
};
function actionToolbar(fileType: OutputParams["fileType"]) {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }
  const { tabId } = tabItem;
  const action: OutputActionCommand = {
    command: "output",
    params: {
      fileType,
      tabId,
      outputWithType: "withComment",
    },
  };
  vscode.postCommand(action);
}
const onCellFocus = (params: CellFocusParams): void => {
  openLogStreamParams.value.canAction = false;
  console.log("onCellFocus:", params);
  const tabItem = getActiveTabItem();
  console.log("tabItem=", tabItem);
  if (!tabItem) {
    console.log("No tab Item");
    return;
  }
  const logGroupName = tabItem.title;
  const logStream = params.rowValues["@logStream"];
  const startTime = params.rowValues["@timestamp"];
  if (tabItem.rootRes["resourceType"] === "LogGroup") {
    openLogStreamParams.value.parentTabId = tabItem.tabId;
    openLogStreamParams.value.logGroupName = logGroupName;
    openLogStreamParams.value.logStream = logStream;
    openLogStreamParams.value.startTime = startTime;
    openLogStreamParams.value.canAction = true;
  }
};

const openStream = (): void => {
  console.log("do emit");
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

defineExpose({
  addTabItem,
  removeTabItem,
  setSearchResult,
});
</script>

<template>
  <section class="ScanPanel">
    <div class="tab-container-actions">
      <button @click="actionToolbar('excel')" title="Output as Excel">
        <fa icon="file-excel" />
      </button>
      <SecondarySelectionAction :items="outputDetailItems" />
    </div>
    <vscode-panels class="tab-wrapper" :activeid="activeTabId" aria-label="With Active Tab">
      <VsCodeTabHeader
        v-for="tabItem in tabItems"
        :id="tabItem.tabId"
        :key="tabItem.tabId"
        :title="`${tabItem.title}:${tabItem.dbType}`"
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
          <div class="toolbar" :style="{ width: `${splitterWidth}px` }">
            <div v-if="isMultiLineKeyword" class="multiple">
              <div class="left">
                <label v-if="tabItem.startTime.visible" for="startTime">{{
                  tabItem.startTime.label
                }}</label
                ><VsCodeTextField
                  v-if="tabItem.startTime.visible"
                  id="startTime"
                  v-model="tabItem.startTime.value"
                  type="datetime-local"
                  :title="tabItem.startTime.description"
                ></VsCodeTextField>

                <label v-if="tabItem.endTime.visible" for="endTime">{{
                  tabItem.endTime.label
                }}</label
                ><VsCodeTextField
                  v-if="tabItem.endTime.visible"
                  id="endTime"
                  v-model="tabItem.endTime.value"
                  type="datetime-local"
                  :title="tabItem.endTime.description"
                ></VsCodeTextField>
                <label v-if="tabItem.limit.visible" for="limit">{{ tabItem.limit.label }}</label
                ><VsCodeTextField
                  v-if="tabItem.limit.visible"
                  id="limit"
                  v-model="tabItem.limit.value"
                  type="number"
                  :min="0"
                  :size="9"
                  :title="tabItem.limit.description"
                ></VsCodeTextField>
              </div>
              <div class="right">
                <label v-if="tabItem.keyword.visible" for="keyword">{{
                  tabItem.keyword.label
                }}</label
                ><VsCodeTextArea
                  v-if="tabItem.keyword.visible"
                  id="keyword"
                  v-model="tabItem.keyword.value"
                  :maxlength="512"
                  :rows="6"
                  :title="tabItem.keyword.description"
                  placeholder="Enter a keyword"
                  style="height: 97%"
                >
                </VsCodeTextArea>

                <VsCodeButton
                  v-show="openLogStreamParams.visible"
                  appearance="secondary"
                  class="openStream"
                  @click="openStream"
                  :disabled="inProgress || !openLogStreamParams.canAction"
                  title="Open logStream"
                >
                  <span class="codicon codicon-link-external"></span>Open logStream
                </VsCodeButton>

                <VsCodeButton class="search" @click="search" :disabled="inProgress" title="scan">
                  <span class="codicon codicon-search"></span>Search
                </VsCodeButton>
              </div>
            </div>
            <div v-else class="single">
              <label v-if="tabItem.startTime.visible" for="startTime">{{
                tabItem.startTime.label
              }}</label
              ><VsCodeTextField
                v-if="tabItem.startTime.visible"
                id="startTime"
                v-model="tabItem.startTime.value"
                type="datetime-local"
                :title="tabItem.startTime.description"
              ></VsCodeTextField>
              <label v-if="tabItem.endTime.visible" for="endTime">{{ tabItem.endTime.label }}</label
              ><VsCodeTextField
                v-if="tabItem.endTime.visible"
                id="endTime"
                v-model="tabItem.endTime.value"
                type="datetime-local"
                :title="tabItem.endTime.description"
              ></VsCodeTextField>
              <label v-if="tabItem.limit.visible" for="limit">{{ tabItem.limit.label }}</label
              ><VsCodeTextField
                v-if="tabItem.limit.visible"
                id="limit"
                v-model="tabItem.limit.value"
                type="number"
                :min="0"
                :size="9"
                :title="tabItem.limit.description"
              ></VsCodeTextField>
              <label v-if="tabItem.keyword.visible" for="keyword">{{ tabItem.keyword.label }}</label
              ><VsCodeTextField
                v-if="tabItem.keyword.visible"
                id="keyword"
                v-model="tabItem.keyword.value"
                :maxlength="128"
                :title="tabItem.keyword.description"
                placeholder="Enter a keyword"
              >
              </VsCodeTextField>
              <VsCodeButton @click="search" :disabled="inProgress" title="scan">
                <fa icon="search" />Search
              </VsCodeButton>
            </div>
          </div>
          <div class="spPaneWrapper">
            <RDHViewer
              v-if="tabItem.rdh != undefined"
              :rdh="tabItem.rdh"
              :width="splitterWidth"
              :height="splitterHeight"
              @onCellFocus="onCellFocus"
            >
            </RDHViewer>
          </div>
        </section>
      </vscode-panel-view>
    </vscode-panels>
  </section>
</template>

<style scoped>
section.ScanPanel {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;
}

vscode-panel-view {
  padding: 7px 4px;
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

.toolbar .single {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  column-gap: 5px;
  margin-bottom: 2px;
}
.toolbar .multiple {
  display: flex;
  column-gap: 2px;
}
.toolbar .multiple .left {
  display: flex;
  flex-direction: column;
  align-items: start;
  justify-content: flex-end;
  column-gap: 5px;
  margin-bottom: 2px;
}
.toolbar .multiple .right {
  display: flex;
  flex-grow: 1;
  flex-direction: column;
}

.toolbar .multiple .right > .openStream {
  position: absolute;
  right: 92px;
  top: -1px;
}
.toolbar .multiple .right > .search {
  position: absolute;
  right: 6px;
  top: -1px;
}
</style>
