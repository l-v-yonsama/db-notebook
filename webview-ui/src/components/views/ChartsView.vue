<script setup lang="ts">
import {
  vscode,
  type ChartsViewEventData,
  type ChartTabItem,
  type CloseTabActionCommand,
} from "@/utilities/vscode";
import {
  provideVSCodeDesignSystem,
  vsCodePanels,
  vsCodePanelTab,
  vsCodePanelView,
} from "@vscode/webview-ui-toolkit";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
  TimeScale,
  Title,
  Tooltip,
} from "chart.js";
import "chartjs-adapter-date-fns";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { nextTick, onMounted, ref } from "vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import VsCodeTabHeader from "../base/VsCodeTabHeader.vue";
import PairPlotChart from "./charts/PairPlotChart.vue";
import { getBase64Image } from "./charts/utils";

import { Bar, Doughnut, Line, Pie, Radar, Scatter } from "vue-chartjs";

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  ChartDataLabels,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  TimeScale
);

provideVSCodeDesignSystem().register(vsCodePanels(), vsCodePanelView(), vsCodePanelTab());

const activeTabId = ref("");
const tabItems = ref([] as ChartTabItem[]);
const activeChartTabItem = ref(null as any);
const inProgress = ref(false);
const sectionWidth = ref(300);
const sectionHeight = ref(300);

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 50, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = sectionWrapper.clientWidth - 14;
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

function getActiveTabItem(): ChartTabItem | undefined {
  const tabId = activeTabId.value.substring(4); // 'tab-'
  return tabItems.value.find((it) => it.tabId === tabId) as ChartTabItem;
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
  activeChartTabItem.value = null;
  await nextTick();
  activeChartTabItem.value = tabItem;
  vscode.postCommand({ command: "selectTab", params: { tabId } });
};

const init = (params: ChartsViewEventData["value"]["init"]) => {
  tabItems.value.splice(0, tabItems.value.length);
  params?.tabItems.forEach((it) => tabItems.value.unshift(it));
  if (params?.currentTabId) {
    showTab(params?.currentTabId);
  }
};

const addTabItem = async (tabItem: ChartTabItem) => {
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

const setSearchResult = ({ tabId, value }: { tabId: string; value: ChartTabItem }) => {
  const tabItem = tabItems.value.find((it) => it.tabId === tabId);
  if (!tabItem) {
    return;
  }
  tabItem.type = value.type;
  tabItem.title = value.title;
  tabItem.options = value.options;
  tabItem.data = value.data;
  tabItem.pairPlotChartParams = value.pairPlotChartParams;
  // tabItem.correlations = value.correlations;
  // tabItem.histograms = value.histograms;
  // tabItem.hueLegends = value.hueLegends;
  // tabItem.rdh = value.rdh;

  nextTick(() => {
    showTab(tabId);
    inProgress.value = false;
    setTimeout(resetSectionHeight, 200);
  });
};

const chartRef = ref<InstanceType<typeof PairPlotChart>>();
const setChartRef = (el: any) => {
  chartRef.value = el;
};

const recieveMessage = (data: ChartsViewEventData) => {
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
    case "init":
      init(value.init);
      break;
  }
};

const replaceSafeFileName = (name: string): string => {
  return name.replace(/[<>#%\{\}\|\\\^~\[\]`;\?:@=& 　]/gi, "_").trim();
};

const export2image = async () => {
  if (!activeChartTabItem.value) {
    return;
  }
  let link = document.createElement("a");

  const { tabId, title, type } = activeChartTabItem.value;
  const id = "chart-" + tabId;
  const fileName = replaceSafeFileName(`chart_${type}_${title}.png`);
  link.download = fileName;
  if (type === "pairPlot") {
    if (!chartRef.value) {
      return;
    }
    link.href = await chartRef.value.getBase64Image(id);
  } else {
    link.href = getBase64Image(id);
  }
  link.click();
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <div class="toolbar top">
      <div class="tool-left"></div>
      <div class="tool-right">
        <VsCodeButton @click="export2image" title="Save"><fa icon="save" />Download</VsCodeButton>
      </div>
    </div>
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
      >
        <section :style="{ width: `${sectionWidth}px` }">
          <div :id="'chart-' + tabItem.tabId" v-if="activeChartTabItem" class="spPaneWrapper">
            <PairPlotChart
              v-if="activeChartTabItem.type === 'pairPlot'"
              :showDataLabels="activeChartTabItem.showDataLabels"
              :showTitle="activeChartTabItem.pairPlotChartParams.showTitle"
              :title="activeChartTabItem.title"
              :pairPlotChartParams="activeChartTabItem.pairPlotChartParams"
              :height="sectionHeight"
              :ref="setChartRef"
            />
            <Line
              v-else-if="activeChartTabItem.type === 'line'"
              :data="activeChartTabItem.data"
              :options="activeChartTabItem.options"
              :style="{ height: `${sectionHeight}px`, position: 'relative' }"
            />
            <Bar
              v-else-if="activeChartTabItem.type === 'bar'"
              :data="activeChartTabItem.data"
              :options="activeChartTabItem.options"
              :style="{ height: `${sectionHeight}px`, position: 'relative' }"
            />
            <Doughnut
              v-else-if="activeChartTabItem.type === 'doughnut'"
              :data="activeChartTabItem.data"
              :options="activeChartTabItem.options"
              :style="{ height: `${sectionHeight}px`, position: 'relative' }"
            />
            <Pie
              v-else-if="activeChartTabItem.type === 'pie'"
              :data="activeChartTabItem.data"
              :options="activeChartTabItem.options"
              :style="{ height: `${sectionHeight}px`, position: 'relative' }"
            />
            <Radar
              v-else-if="activeChartTabItem.type === 'radar'"
              :data="activeChartTabItem.data"
              :options="activeChartTabItem.options"
              :style="{ height: `${sectionHeight}px`, position: 'relative' }"
            />
            <Scatter
              v-else-if="activeChartTabItem.type === 'scatter'"
              :data="activeChartTabItem.data"
              :options="activeChartTabItem.options"
              :style="{ height: `${sectionHeight}px`, position: 'relative' }"
            />
          </div>
        </section>
      </vscode-panel-view>
    </vscode-panels>
  </section>
</template>

<style lang="scss" scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 1px;
  padding: 1px;
}
</style>
