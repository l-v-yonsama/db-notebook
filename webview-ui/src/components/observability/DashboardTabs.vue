<script setup lang="ts">
import type { DashboardTabPresentation } from "@/utilities/vscode";
import { nextTick, ref } from "vue";

defineProps<{ tabs: DashboardTabPresentation[]; activeTabId: string }>();
const emit = defineEmits<{ (event: "select", tabId: string): void }>();
const tabButtons = ref<HTMLButtonElement[]>([]);

function selectByKeyboard(event: KeyboardEvent, index: number, tabs: DashboardTabPresentation[]): void {
  let nextIndex: number | undefined;
  if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
  if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === undefined) return;
  event.preventDefault();
  emit("select", tabs[nextIndex].id);
  void nextTick(() => tabButtons.value[nextIndex]?.focus());
}
</script>

<template>
  <nav v-if="tabs.length > 1" class="tabs" aria-label="Dashboard views">
    <button
      v-for="(tab, index) in tabs"
      :key="tab.id"
      ref="tabButtons"
      type="button"
      role="tab"
      :id="`dashboard-tab-${tab.id}`"
      :aria-controls="`dashboard-tabpanel-${tab.id}`"
      :aria-selected="tab.id === activeTabId"
      :tabindex="tab.id === activeTabId ? 0 : -1"
      :class="{ active: tab.id === activeTabId }"
      @click="$emit('select', tab.id)"
      @keydown="selectByKeyboard($event, index, tabs)"
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
