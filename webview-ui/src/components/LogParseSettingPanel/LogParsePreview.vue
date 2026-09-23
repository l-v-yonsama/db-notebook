<script setup lang="ts">
import type { ResultSetData } from "@l-v-yonsama/rdh";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import RDHViewer from "../RDHViewer.vue";

const props = withDefaults(
  defineProps<{ rdh: ResultSetData; total: number; showCount?: boolean; label?: string }>(),
  {
    showCount: true,
  }
);
const tableConfig = {
  hideRowColumn: true,
  displayComment: false,
  displayType: false,
  dateFormat: undefined,
  timestampFormat: undefined,
  binaryToHex: false,
};
const area = ref<HTMLElement>();
const width = ref(600);
const version = ref(0);
watch(
  () => props.rdh,
  () => version.value++
);
const height = computed(() => Math.min(300, Math.max(110, props.rdh.rows.length * 28 + 64)));
const observer = new ResizeObserver(([entry]) => {
  if (entry.contentRect.width > 0) width.value = entry.contentRect.width;
});
watch(area, (element) => {
  observer.disconnect();
  if (element) observer.observe(element);
});
onBeforeUnmount(() => observer.disconnect());
</script>

<template>
  <div ref="area" class="log-preview">
    <p v-if="showCount !== false">
      {{ label ? `${label} ·` : "Showing" }} {{ rdh.rows.length }} of {{ total }} rows.
    </p>
    <RDHViewer :key="version" :rdh="rdh" :width="width" :height="height" :config="tableConfig" />
  </div>
</template>

<style scoped>
.log-preview {
  min-width: 0;
}
p {
  margin: 6px 0;
  opacity: 0.8;
}
</style>
