<script setup lang="ts">
defineProps<{
  markers: Array<{ metricId: string; observedAt: string; reasonLabel: string }>;
}>();
</script>

<template>
  <aside v-if="markers.length" class="reset-markers" aria-label="Statistics reset markers">
    <strong>Statistics reset</strong>
    <ul>
      <li v-for="marker in markers.slice(-5)" :key="`${marker.metricId}:${marker.observedAt}`">
        {{ new Date(marker.observedAt).toLocaleString() }} · {{ marker.reasonLabel }}
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.reset-markers {
  padding: 7px 9px;
  border-left: 3px solid var(--vscode-editorWarning-foreground);
  background: var(--vscode-textBlockQuote-background);
}
ul { margin: 4px 0 0; padding-left: 20px; }
</style>
