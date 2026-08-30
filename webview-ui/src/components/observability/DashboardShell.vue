<script setup lang="ts">
import type { DashboardNotice, DashboardTargetPresentation } from "@/utilities/vscode";
import DashboardNoticeList from "./DashboardNoticeList.vue";
import DashboardScopeBadge from "./DashboardScopeBadge.vue";

defineProps<{
  target: DashboardTargetPresentation;
  notices: DashboardNotice[];
  collectedAt?: string;
}>();
</script>

<template>
  <section class="dashboard-shell">
    <header>
      <div>
        <h1 :title="target.fullDisplayName ?? target.displayName">{{ target.displayName }}</h1>
        <p>
          {{ target.sourceLabel }}
          <span v-if="target.environmentLabel"> · {{ target.environmentLabel }}</span>
          <span v-if="collectedAt"> · Updated {{ new Date(collectedAt).toLocaleString() }}</span>
        </p>
      </div>
      <DashboardScopeBadge
        :label="target.scope.label"
        :full-label="target.scope.fullLabel"
      />
    </header>
    <DashboardNoticeList :notices="notices" />
    <slot />
  </section>
</template>

<style scoped>
.dashboard-shell {
  display: grid;
  gap: 12px;
  width: 100%;
  min-width: 0;
}
header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}
h1 {
  margin: 0;
  font-size: 1.45rem;
  overflow-wrap: anywhere;
}
p {
  margin: 4px 0 0;
  color: var(--vscode-descriptionForeground);
}
</style>
