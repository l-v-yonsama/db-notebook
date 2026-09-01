<script setup lang="ts">
defineProps<{ label: string; fullLabel?: string }>();
</script>

<template>
  <span class="scope-badge" :title="fullLabel ?? label">{{ label }}</span>
</template>

<style scoped>
.scope-badge {
  border: 1px solid var(--vscode-badge-background);
  border-radius: 999px;
  padding: 2px 8px;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  white-space: nowrap;
}
</style>
