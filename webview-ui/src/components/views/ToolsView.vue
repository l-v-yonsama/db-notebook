<script setup lang="ts">
import type { DropdownItem, SecondaryItem } from "@/types/Components";
import { StatementStatisticsSortKey } from "@/types/lib/StatementStatisticsSortKey";
import type { CellFocusParams } from "@/types/RdhEvents";
import {
  vscode,
  type QueryStatisticsPreviewStatus,
  type QueryStatisticsSearchParams,
  type QueryStatisticsSearchStatus,
  type ToolsViewEventData,
} from "@/utilities/vscode";
import { toNum, type ResultSetData } from "@l-v-yonsama/rdh";
import { nextTick, onMounted, ref } from "vue";
import SecondarySelectionAction from "../base/SecondarySelectionAction.vue";
import VsCodeButton from "../base/VsCodeButton.vue";
import VsCodeDropdown from "../base/VsCodeDropdown.vue";
import VsCodeTextField from "../base/VsCodeTextField.vue";
import RDHViewer from "../RDHViewer.vue";

const sectionWidth = ref(300);
const sectionHeight = ref(300);
const mode = ref("sessions" as ToolsViewEventData["value"]["refresh"]["mode"]);
const rdh = ref(undefined as ResultSetData | undefined);
const clickedCellParams = ref(undefined as CellFocusParams | undefined);

// --- Query Statistics mode only ---
const searchStatus = ref<QueryStatisticsSearchStatus>("loading");
const searchMessage = ref<string | undefined>(undefined);
const previewStatus = ref<QueryStatisticsPreviewStatus>("idle");
const previewMessage = ref<string | undefined>(undefined);
const previewTechnicalMessage = ref<string | undefined>(undefined);
const resultVersion = ref(0);
const database = ref<{ connectionName: string; databaseName: string; vendor: string } | undefined>(
  undefined
);
const search = ref<QueryStatisticsSearchParams>({
  sortBy: StatementStatisticsSortKey.TotalElapsedTime,
  limit: 100,
  minimumAverageElapsedTimeMs: 0,
});

// Separate from `search` above (the last *applied*/server-confirmed
// conditions) - these are the raw form fields the user is currently
// editing. Changing them alone never triggers a search; only Search/Refresh
// or Enter does (§10 Phase 5 "入力変更だけでは検索せず...明示実行する").
// minimumAverageElapsedTimeMs has no UI control - always sent as 0 (per user
// feedback: the field added noise nobody used; the backend still accepts and
// stores it, so a future UI can reintroduce a control without a schema change).
const sortByInput = ref<string>(StatementStatisticsSortKey.TotalElapsedTime);
const limitInput = ref<string>("100");

const sortByItems: DropdownItem[] = [
  { value: StatementStatisticsSortKey.TotalElapsedTime, label: "Total elapsed time" },
  { value: StatementStatisticsSortKey.AverageElapsedTime, label: "Average elapsed time" },
  { value: StatementStatisticsSortKey.MaxElapsedTime, label: "Max elapsed time" },
  { value: StatementStatisticsSortKey.ExecutionCount, label: "Execution count" },
];

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    const minusHeight = mode.value === "queryStatistics" ? 116 : 76;
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - minusHeight, 100);
  }
  if (sectionWrapper?.clientWidth) {
    sectionWidth.value = sectionWrapper.clientWidth - 14;
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const clearSelection = () => {
  clickedCellParams.value = undefined;
};

const refresh = async (v: ToolsViewEventData["value"]["refresh"]) => {
  if (v === undefined) {
    return;
  }

  if (v.mode === "queryStatistics") {
    mode.value = v.mode;
    searchStatus.value = v.searchStatus;
    searchMessage.value = v.message;
    previewStatus.value = v.previewStatus;
    previewMessage.value = v.previewMessage;
    previewTechnicalMessage.value = v.previewTechnicalMessage;
    database.value = v.database;
    search.value = v.search;

    // A new resultVersion means this is a fresh search cycle (its very
    // first "loading" post already carries the bumped version) - reset the
    // row selection exactly then, never on a preview-status-only update
    // that leaves resultVersion unchanged (§10 Phase 5 "refresh / mode変更
    // 時はclickedCellParamsを必ずclearする"). Bind Parameters input itself
    // no longer lives in this component at all (2026-08-19 follow-up) -
    // PerformanceTuningBindParametersPanel owns that now, opened only when
    // the target SQL actually has placeholders.
    if (v.resultVersion !== resultVersion.value) {
      resultVersion.value = v.resultVersion;
      clearSelection();
      sortByInput.value = v.search.sortBy;
      limitInput.value = String(v.search.limit);
      rdh.value = undefined;
      await nextTick();
      rdh.value = v.rdh;
    }
    return;
  }

  mode.value = v.mode;
  rdh.value = undefined;
  clickedCellParams.value = undefined;

  await nextTick();
  rdh.value = v.rdh;
};

const close = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const canOutput = (): boolean => {
  if (mode.value === "queryStatistics") {
    return rdh.value !== undefined && (searchStatus.value === "ready" || searchStatus.value === "empty");
  }
  return true;
};

const output = (fileType: 'excel' | 'html'): void => {
  vscode.postCommand({
    command: "output",
    params: {
      tabId: "",
      fileType,
      displayOnlyChanged: false,
    },
  });
};

// "Export ▾" combines the old always-separate Output as HTML / Output as
// Excel buttons into one low-frequency-action menu (per user feedback).
// Built on the existing SecondarySelectionAction rather than a hand-rolled
// dropdown - a first attempt at rolling this by hand opened and immediately
// closed the menu on the same click (the click-outside listener attaching
// mid-dispatch and catching the very click that opened it); this component
// already solves that (its own `beforeOpened` guard) since it's used the
// same way elsewhere (e.g. MdhView.vue's Copy-to-clipboard/Compare menus).
const exportItems: SecondaryItem<'html' | 'excel'>[] = [
  { kind: "selection", label: "HTML", value: "html" },
  { kind: "selection", label: "Excel", value: "excel" },
];

const onSelectExport = (fileType: 'html' | 'excel'): void => {
  output(fileType);
};

const searchAgain = (): void => {
  rdh.value = undefined;
  clearSelection();
  vscode.postCommand({
    command: "refresh",
    params: {
      tabId: "",
    },
  });
};

const searchQueryStatisticsAgain = (): void => {
  clearSelection();
  vscode.postCommand({
    command: "searchQueryStatistics",
    params: {
      sortBy: sortByInput.value as QueryStatisticsSearchParams["sortBy"],
      limit: Number(limitInput.value),
      minimumAverageElapsedTimeMs: 0,
    },
  });
};

const onSearchFieldKeyup = (event: KeyboardEvent): void => {
  if (event.key === "Enter") {
    searchQueryStatisticsAgain();
  }
};

const kill = () => {
  if (clickedCellParams.value === undefined) {
    return;
  }
  const { rowValues } = clickedCellParams.value;
  if (rowValues === undefined) {
    return;
  }
  clickedCellParams.value = undefined;

  let sessionOrPid: number | undefined = undefined;
  if (rowValues['session_id']) {
    // MySQL (getSessions) / SQL Server (getSessions, getLocks)
    sessionOrPid = toNum(rowValues['session_id']);
  } else if (rowValues['pid']) {
    // Postgres (getSessions, getLocks)
    sessionOrPid = toNum(rowValues['pid']);
  } else if (rowValues['SID']) {
    // Oracle (getSessions, getLocks) -- SERIAL# is looked up internally by
    // OracleDriver.kill() from this SID, so only SID needs to be sent here.
    sessionOrPid = toNum(rowValues['SID']);
  }
  vscode.postCommand({
    command: "kill",
    params: {
      sessionOrPid
    },
  });
};

const canPreview = (): boolean =>
  mode.value === "queryStatistics" &&
  clickedCellParams.value !== undefined &&
  previewStatus.value !== "collecting";

// No bind values sent here (2026-08-19 follow-up) - ToolsViewProvider
// re-resolves the row's SQL and its Bind Parameters estimate itself, and
// hands off to PerformanceTuningBindParametersPanel when any are found.
const previewPerformanceTuning = (): void => {
  if (!canPreview() || clickedCellParams.value === undefined) {
    return;
  }
  vscode.postCommand({
    command: "previewPerformanceTuning",
    params: {
      resultVersion: resultVersion.value,
      rowIndex: clickedCellParams.value.rowPos,
    },
  });
};

const recieveMessage = (data: ToolsViewEventData) => {
  const { command, value } = data;
  switch (command) {
    case "refresh":
      if (value.refresh === undefined) {
        return;
      }
      refresh(value.refresh);
      break;
  }
};

const onClickCell = (params: CellFocusParams): void => {
  clickedCellParams.value = params;
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <div class="toolbar">
      <div class="tool-left" v-if="mode === 'queryStatistics'" @keyup="onSearchFieldKeyup">
        <label>Sort by</label>
        <VsCodeDropdown :items="sortByItems" v-model="sortByInput" />
        <label>Limit</label>
        <VsCodeTextField type="number" :min="1" :max="1000" :size="4" v-model="limitInput" style="width: 100px" />
        <VsCodeButton @click="searchQueryStatisticsAgain" title="Search with the conditions above"
          :disabled="previewStatus === 'collecting'">
          <fa icon="search" />Search
        </VsCodeButton>
      </div>
      <div class="tool-right">
        <SecondarySelectionAction class="export-menu" title="Export the current result" label="Export"
          :items="exportItems" :disabled="!canOutput()" @onSelect="onSelectExport" />
        <VsCodeButton v-if="mode !== 'queryStatistics'" @click="searchAgain" appearance="secondary"
          title="Search again">
          <fa icon="rotate" />Refresh
        </VsCodeButton>
        <VsCodeButton v-if="mode !== 'queryStatistics'" :disabled="clickedCellParams === undefined"
          title="Kill session" @click="kill">
          <fa icon="circle-play" />Kill session
        </VsCodeButton>
        <VsCodeButton v-if="mode === 'queryStatistics'" :disabled="!canPreview()"
          title="Preview performance tuning context for the selected query" @click="previewPerformanceTuning">
          <fa icon="magnifying-glass-chart" />Preview tuning data
        </VsCodeButton>
        <VsCodeButton @click="close" appearance="secondary" title="Close" aria-label="Close">
          <fa icon="times" />
        </VsCodeButton>
      </div>
    </div>

    <div v-if="mode === 'queryStatistics' && database" class="qs-header">
      <div class="row">
        <span class="label">Connection</span>
        <span>{{ database.connectionName }} ・ {{ database.vendor }} ・ {{ database.databaseName }}</span>
      </div>
      <div v-if="searchStatus !== 'ready'" class="status-banner" :class="searchStatus">
        <span v-if="searchStatus === 'loading'"><fa icon="spinner" spin />&nbsp;Loading query statistics...</span>
        <span v-else-if="searchStatus === 'unavailable'">{{
          searchMessage || "Query statistics are unavailable for this connection."
        }}</span>
        <span v-else-if="searchStatus === 'empty'">No query statistics matched the current search conditions.</span>
        <span v-else-if="searchStatus === 'error'">{{ searchMessage || "Failed to load query statistics." }}</span>
      </div>
    </div>

    <section class="content">
      <RDHViewer v-if="rdh" :rdh="rdh" :width="sectionWidth" :height="sectionHeight" :config="null"
        @onClickCell="onClickCell" />

      <div v-if="mode === 'queryStatistics' && clickedCellParams" class="qs-selection">
        <div v-if="previewStatus === 'collecting'" class="status-banner loading">
          <fa icon="spinner" spin />&nbsp;Collecting performance tuning context...
        </div>
        <div v-else-if="previewStatus === 'cancelled'" class="status-banner">Collection cancelled.</div>
        <div v-else-if="previewStatus === 'error'" class="status-banner error">
          {{ previewMessage || "Failed to collect performance tuning context." }}
          <details v-if="previewTechnicalMessage">
            <summary>Technical details</summary>
            <p>{{ previewTechnicalMessage }}</p>
          </details>
        </div>
      </div>
    </section>
  </section>
</template>

<style lang="scss" scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 1px;
  padding: 1px;
}

.control {
  width: 110px;
  max-width: 110px;
}

div.scroll-wrapper {
  overflow: auto;
}

.tool-left {
  display: flex;
  align-items: center;
  gap: 4px;

  label {
    margin-left: 6px;
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
  }
}

.qs-header {
  padding: 2px 4px;
}

.row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 2px;
}

.label {
  font-weight: 600;
}

.status-banner {
  padding: 2px 4px;
  color: var(--vscode-descriptionForeground);
}

.status-banner.error {
  color: var(--vscode-errorForeground);
}

.qs-selection {
  padding: 4px;
  border-top: calc(var(--border-width) * 1px) solid var(--dropdown-border);
}

// .export-menu itself needs no rules here - SecondarySelectionAction.vue
// (base component) already styles its own trigger/dropdown, including the
// labeled ("Export ▾") button chrome.
</style>
