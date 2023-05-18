<script setup lang="ts">
import type { ResultSetDataHolder } from "@/types/lib/ResultSetDataHolder";
import RDH from "./RDH.vue";
import type { CellFocusParams } from "@/types/RdhEvents";

type Props = {
  width: number;
  height: number;
  rdh: ResultSetDataHolder;
  readonly: boolean;
};

const props = defineProps<Props>();

const emit = defineEmits<{
  (event: "onCellFocus", value: CellFocusParams): void;
}>();

// function refresh() {
//   emit("postMessageToExtension", { command: "refresh", data: {} });
// }
// function exportFile(type: string) {
//   emit("postMessageToExtension", { command: "export", data: { type } });
// }
function onCellFocus(params: CellFocusParams) {
  emit("onCellFocus", params);
}
</script>

<template>
  <section>
    <splitpanes
      class="default-theme"
      :style="{ 'max-width': `${width}px`, 'height': `${height}px` }"
    >
      <pane min-size="5">
        <RDH :rdh="rdh" :height="height" :readonly="readonly" @onCellFocus="onCellFocus"> </RDH>
      </pane>
      <pane v-if="false">
        <div class="right">aaaaaa</div>
      </pane>
    </splitpanes>
  </section>
</template>

<style scoped>
section {
  display: block;
  width: 100%;
}
</style>
