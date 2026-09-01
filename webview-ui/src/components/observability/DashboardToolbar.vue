<script setup lang="ts">
import type { DashboardSelector } from "@/utilities/vscode";
import VsCodeButton from "@/components/base/VsCodeButton.vue";

defineProps<{
  selectors: DashboardSelector[];
  loading: boolean;
  queryCount?: number;
  autoRefreshAllowed?: boolean;
  autoRefreshMinutes?: number;
}>();
const emit = defineEmits<{
  (event: "select", selectorId: string, value: string): void;
  (event: "refresh"): void;
  (event: "cancel"): void;
  (event: "set-auto-refresh", intervalMinutes: number): void;
  (event: "export"): void;
  (event: "close"): void;
}>();

function selected(event: Event, selectorId: string): void {
  emit("select", selectorId, (event.target as HTMLSelectElement).value);
}

function autoRefreshSelected(event: Event): void {
  emit("set-auto-refresh", Number((event.target as HTMLSelectElement).value));
}
</script>

<template>
  <div class="dashboard-toolbar" aria-label="Dashboard controls">
    <label v-for="selector in selectors" :key="selector.id">
      <span>{{ selector.label }}</span>
      <select
        v-if="selector.options.length > 1"
        :value="selector.value"
        :aria-label="selector.label"
        @change="selected($event, selector.id)"
      >
        <option v-for="option in selector.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <strong v-else>{{ selector.options[0]?.label ?? selector.value }}</strong>
    </label>
    <label v-if="autoRefreshAllowed !== undefined">
      <span>Auto refresh</span>
      <select
        v-if="autoRefreshAllowed"
        :value="autoRefreshMinutes ?? 0"
        aria-label="Auto refresh interval"
        @change="autoRefreshSelected"
      >
        <option :value="0">Off</option>
        <option :value="1">Every 1 minute</option>
        <option :value="5">Every 5 minutes</option>
        <option :value="15">Every 15 minutes</option>
      </select>
      <strong v-else title="Auto refresh is not available for this view">Manual only</strong>
    </label>
    <span v-if="queryCount !== undefined" class="query-count"
      >{{ queryCount }} series / refresh</span
    >
    <VsCodeButton
      v-if="loading"
      title="Cancel refresh"
      appearance="secondary"
      @click="$emit('cancel')"
    >
      Cancel
    </VsCodeButton>
    <VsCodeButton v-else title="Refresh metrics" appearance="primary" @click="$emit('refresh')">
      Refresh
    </VsCodeButton>
    <VsCodeButton
      title="Export current snapshot to notebook"
      appearance="secondary"
      @click="$emit('export')"
    >
      Export to Notebook
    </VsCodeButton>
    <VsCodeButton title="Close dashboard" appearance="secondary" @click="$emit('close')">
      Close
    </VsCodeButton>
  </div>
</template>

<style scoped>
.dashboard-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
}
label {
  display: grid;
  gap: 3px;
}
label span,
.query-count {
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
}
select {
  min-width: 130px;
  padding: 4px 24px 4px 7px;
  color: var(--vscode-dropdown-foreground);
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
}
.query-count {
  margin-left: auto;
  align-self: center;
}
</style>
