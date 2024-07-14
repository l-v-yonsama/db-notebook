<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type { CellFocusParams } from "@/types/RdhEvents";
import type {
  CloseTabActionCommand,
  HarFilePanelEventData,
  HarFileTabItem,
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import type { ResultSetData } from "@l-v-yonsama/rdh";
import {
  provideVSCodeDesignSystem,
  vsCodePanels,
  vsCodePanelTab,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import { defineExpose, nextTick, onMounted, ref } from "vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTabHeader from "./base/VsCodeTabHeader.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import RDHViewer from "./RDHViewer.vue";

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

const activeTabId = ref("");
const tabItems = ref([] as HarFileTabItem[]);
const inProgress = ref(false);
const splitterWidth = ref(300);
const splitterHeight = ref(300);
const keyword = ref("");
const eventRdh = ref(null as ResultSetData | null);
const statusType = ref("");
const statusTypeItems = ref([] as DropdownItem[]);
const contentType = ref("");
const contentTypeItems = ref([] as DropdownItem[]);
const methodType = ref("");
const methodTypeItems = ref([] as DropdownItem[]);

const rowIndexResolver = new Map<number, number>();

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.HarFilePanel");
  if (sectionWrapper?.clientHeight) {
    splitterHeight.value = Math.max(sectionWrapper?.clientHeight - 79, 10);
  }
  if (sectionWrapper?.clientWidth) {
    splitterWidth.value = Math.max(sectionWrapper.clientWidth - 14, 10);
  }
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
});

function getActiveTabItem(): HarFileTabItem | undefined {
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as HarFileTabItem;
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

  // STATUS
  const statusTypes = [...new Set(tabItem.res.log.entries.map((e) => e.response.status))];
  statusTypes.sort();
  statusTypeItems.value.splice(0, statusTypeItems.value.length);
  statusTypeItems.value.push({
    label: "-",
    value: "",
  });
  statusTypes.forEach((it) => {
    statusTypeItems.value.push({
      label: it + "",
      value: it + "",
    });
  });
  statusTypeItems.value.push({
    label: "400 or more",
    value: "ge400",
  });
  statusTypeItems.value.push({
    label: "Less than 400",
    value: "lt400",
  });
  statusType.value = "";

  // METHOD
  const methodTypes = [...new Set(tabItem.res.log.entries.map((e) => e.request.method))];
  methodTypes.sort();
  methodTypeItems.value.splice(0, methodTypeItems.value.length);
  methodTypeItems.value.push({
    label: "-",
    value: "",
  });

  methodTypes.forEach((it) => {
    methodTypeItems.value.push({
      label: it,
      value: it,
    });
  });
  methodType.value = "";

  // Content-type
  const mimeTypes = [...new Set(tabItem.res.log.entries.map((e) => e.response.content.mimeType))];
  mimeTypes.sort();
  contentTypeItems.value.splice(0, contentTypeItems.value.length);
  contentTypeItems.value.push({
    label: "-",
    value: "",
  });

  mimeTypes.forEach((it) => {
    contentTypeItems.value.push({
      label: it,
      value: it,
    });
  });
  contentType.value = "";

  resetActiveInnerRdh();
  vscode.postCommand({ command: "selectTab", params: { tabId } });
};

const resetActiveInnerRdh = () => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  eventRdh.value = null;

  const copied = JSON.parse(JSON.stringify(tabItem.rdh)) as any;

  nextTick(() => {
    rowIndexResolver.clear();
    const copiedRows = [];
    const rows = tabItem.rdh.rows;
    for (let i = 0; i < rows.length; i++) {
      let pickup = true;

      if (keyword.value.length > 0) {
        const lk = keyword.value.toLocaleLowerCase();
        pickup = rows[i].values.url.toLowerCase().indexOf(lk) >= 0;
      }
      if (pickup && statusType.value) {
        const status = statusType.value;
        if (status === "ge400") {
          pickup = rows[i].values.status >= 400;
        } else if (status === "lt400") {
          pickup = rows[i].values.status < 400;
        } else {
          pickup = rows[i].values.status === Number(status);
        }
      }
      if (pickup && methodType.value) {
        const method = methodType.value;
        pickup = rows[i].values.method === method;
      }
      if (pickup && contentType.value) {
        const ct = contentType.value;
        pickup = rows[i].values.contentType === ct;
      }

      if (pickup) {
        rowIndexResolver.set(copiedRows.length, i);
        copiedRows.push(rows[i]);
      }
    }
    copied.rows = copiedRows;
    eventRdh.value = copied;
  });
};

const addTabItem = (tabItem: HarFileTabItem) => {
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

const setSearchResponse = ({ tabId, value }: { tabId: string; value: any }) => {
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  tabItem.res = value.res;
  tabItem.rdh = value.rdh;
  nextTick(() => {
    inProgress.value = false;
    setTimeout(resetSpPaneWrapperHeight, 200);
  });
};

const recieveMessage = (data: HarFilePanelEventData) => {
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

const onClickCell = (params: CellFocusParams): void => {
  const tabItem = getActiveTabItem();
  if (!tabItem) {
    return;
  }

  const innerIndex = rowIndexResolver.get(params.rowPos);
  if (innerIndex !== undefined) {
    vscode.postCommand({
      command: "selectInnerTab",
      params: { tabId: tabItem.tabId, innerIndex },
    });
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="HarFilePanel">
    <div class="tab-container-actions"></div>

    <vscode-panels class="tab-wrapper" :activeid="activeTabId" aria-label="With Active Tab">
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
        class="panel-view"
      >
        <div v-if="eventRdh" class="toolbar">
          <label for="keyword"><fa icon="search" style="margin-right: 3px" />URL</label>
          <VsCodeTextField
            id="keyword"
            v-model="keyword"
            placeholder="Enter a keyword"
            @change="resetActiveInnerRdh"
          >
          </VsCodeTextField>
          <label for="status-type">Status</label>
          <VsCodeDropdown
            id="status-type"
            v-model="statusType"
            :items="statusTypeItems"
            style="z-index: 15"
            @change="resetActiveInnerRdh"
          />
          <label for="method-type">Method</label>
          <VsCodeDropdown
            id="method-type"
            v-model="methodType"
            :items="methodTypeItems"
            style="z-index: 15"
            @change="resetActiveInnerRdh"
          />
          <label for="content-type">Content-type</label>
          <VsCodeDropdown
            id="content-type"
            v-model="contentType"
            :items="contentTypeItems"
            style="z-index: 15; width: 160px"
            @change="resetActiveInnerRdh"
          />
        </div>
        <section :style="{ width: `${splitterWidth}px` }">
          <div v-if="eventRdh" class="spPaneWrapper">
            <RDHViewer
              :rdh="eventRdh"
              :width="splitterWidth"
              :height="splitterHeight"
              :readonly="true"
              @onClickCell="onClickCell"
            />
          </div>
        </section>
      </vscode-panel-view>
    </vscode-panels>
  </section>
</template>

<style lang="scss" scoped>
section.HarFilePanel {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;

  .panel-view {
    display: flex;
    flex-direction: column;

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      column-gap: 5px;
      margin: 2px 0;

      .limit {
        max-width: 100px;
      }
    }
  }
}

vscode-panel-view {
  padding: 4px;
}

.primary {
  color: var(--button-primary-foreground) !important;
  background: var(--button-primary-background) !important;
}
</style>
