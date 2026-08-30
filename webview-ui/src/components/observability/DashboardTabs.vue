<script setup lang="ts">
import type { DashboardTabPresentation } from "@/utilities/vscode";

defineProps<{ tabs: DashboardTabPresentation[]; activeTabId: string }>();
defineEmits<{ (event: "select", tabId: string): void }>();
</script>

<template>
  <nav v-if="tabs.length > 1" class="tabs" aria-label="Dashboard views">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      :aria-selected="tab.id === activeTabId"
      :class="{ active: tab.id === activeTabId }"
      @click="$emit('select', tab.id)"
    >
      {{ tab.title }}
    </button>
  </nav>
</template>

<style scoped>
.tabs {
  display: flex;
  border-bottom: 1px solid var(--vscode-panel-border);
}
button {
  padding: 7px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--vscode-foreground);
  background: transparent;
  cursor: pointer;
}
button:hover {
  background: var(--vscode-list-hoverBackground);
}
button.active {
  border-bottom-color: var(--vscode-focusBorder);
  font-weight: 600;
}
</style>
