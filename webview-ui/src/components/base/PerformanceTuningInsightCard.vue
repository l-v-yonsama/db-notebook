<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  tone: "info" | "warning" | "unknown";
  title: string;
  summary: string;
  metadata?: string;
}>();

const iconClass = computed(() => {
  if (props.tone === "warning") {
    return "codicon-warning";
  }
  if (props.tone === "unknown") {
    return "codicon-question";
  }
  return "codicon-info";
});

const toneLabel = computed(() => {
  if (props.tone === "warning") {
    return "Warning";
  }
  if (props.tone === "unknown") {
    return "Unknown";
  }
  return "Information";
});
</script>

<template>
  <div class="PerformanceTuningInsightCard" :class="props.tone">
    <div class="summary-row">
      <span class="codicon" :class="iconClass" aria-hidden="true"></span>
      <span class="visually-hidden">{{ toneLabel }}:</span>
      <div class="text">
        <div class="title-row">
          <p class="title">{{ props.title }}</p>
          <span v-if="props.metadata" class="metadata">{{ props.metadata }}</span>
        </div>
        <p class="summary">{{ props.summary }}</p>
        <slot></slot>
      </div>
    </div>
    <slot name="details"></slot>
  </div>
</template>

<style scoped>
.PerformanceTuningInsightCard {
  border-left: 3px solid var(--vscode-editorWidget-border);
  padding: 4px 8px;
  margin-bottom: 8px;
  border-radius: 2px;
  background: var(--vscode-editorWidget-background);
}

.PerformanceTuningInsightCard.info {
  border-left-color: var(--vscode-notificationsInfoIcon-foreground);
}

.PerformanceTuningInsightCard.warning {
  border-left-color: var(--vscode-editorWarning-foreground);
}

.PerformanceTuningInsightCard.unknown {
  border-left-color: var(--vscode-descriptionForeground);
}

.summary-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.PerformanceTuningInsightCard.info .codicon {
  color: var(--vscode-notificationsInfoIcon-foreground);
}

.PerformanceTuningInsightCard.warning .codicon {
  color: var(--vscode-editorWarning-foreground);
}

.PerformanceTuningInsightCard.unknown .codicon {
  color: var(--vscode-descriptionForeground);
}

.text {
  flex: 1 1 auto;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}

.title {
  font-weight: 600;
  margin: 0 0 2px 0;
}

.summary {
  margin: 0;
}

.metadata {
  color: var(--vscode-descriptionForeground);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
