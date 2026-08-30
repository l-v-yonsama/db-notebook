<script setup lang="ts">
import type { DashboardNotice } from "@/utilities/vscode";

defineProps<{ notices: DashboardNotice[] }>();
</script>

<template>
  <section v-if="notices.length" class="notices" aria-label="Dashboard notices">
    <article v-for="notice in notices" :key="notice.id" class="notice" :class="notice.severity">
      <strong>{{ notice.title }}</strong>
      <span>{{ notice.message }}</span>
      <a v-if="notice.documentationUrl" :href="notice.documentationUrl">Documentation</a>
    </article>
  </section>
</template>

<style scoped>
.notices {
  display: grid;
  gap: 6px;
}
.notice {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-left: 3px solid var(--vscode-editorInfo-foreground);
  background: var(--vscode-textBlockQuote-background);
}
.notice.warning {
  border-color: var(--vscode-editorWarning-foreground);
}
.notice.error {
  border-color: var(--vscode-editorError-foreground);
}
.notice span {
  flex: 1;
}
</style>
