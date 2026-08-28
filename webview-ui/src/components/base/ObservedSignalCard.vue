<script setup lang="ts">
import type {
  DynamoDbPerformanceTuningHumanSignal,
  PerformanceTuningHumanSignal,
} from "@/utilities/vscode";
import { computed } from "vue";
import PerformanceTuningInsightCard from "./PerformanceTuningInsightCard.vue";

const props = defineProps<{
  signal: PerformanceTuningHumanSignal | DynamoDbPerformanceTuningHumanSignal;
}>();

const tone = computed(() => {
  if (props.signal.level === "attention") {
    return "warning" as const;
  }
  return props.signal.level;
});

const tableRef = computed(() =>
  "tableRef" in props.signal ? props.signal.tableRef : undefined
);
</script>

<template>
  <PerformanceTuningInsightCard
    class="ObservedSignalCard"
    :tone="tone"
    :title="props.signal.title"
    :summary="props.signal.summary"
    :metadata="tableRef"
  >
    <template #details>
      <details class="evidence-details">
        <summary>Evidence details</summary>
        <p>{{ props.signal.rawDataPath }}</p>
      </details>
    </template>
  </PerformanceTuningInsightCard>
</template>

<style scoped>
.evidence-details {
  margin-top: 6px;
}

.evidence-details summary {
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
  font-size: 0.9em;
}

.evidence-details p {
  color: var(--vscode-descriptionForeground);
  font-size: 0.85em;
  margin: 4px 0 2px 0;
}
</style>
