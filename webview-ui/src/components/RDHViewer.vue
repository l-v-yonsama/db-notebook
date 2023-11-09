<script setup lang="ts">
import { ref } from "vue";
import type { ResultSetData } from "@l-v-yonsama/multi-platform-database-drivers";
import RDH from "./RDH.vue";
import type { CellFocusParams } from "@/types/RdhEvents";

type Props = {
  width: number;
  height: number;
  rdh: ResultSetData;
  readonly: boolean;
  showOnlyChanged?: boolean;
};

const props = defineProps<Props>();

const rdhRef = ref<InstanceType<typeof RDH>>();
const setRdhRef = (el: any) => {
  rdhRef.value = el;
};

const emit = defineEmits<{
  (event: "onClickCell", value: CellFocusParams): void;
}>();

// function refresh() {
//   emit("postMessageToExtension", { command: "refresh", data: {} });
// }
// function exportFile(type: string) {
//   emit("postMessageToExtension", { command: "export", data: { type } });
// }
function onClickCell(params: CellFocusParams) {
  emit("onClickCell", params);
}

const save = (): any => {
  return rdhRef.value?.save();
};

defineExpose({
  save,
});
</script>

<template>
  <section>
    <splitpanes
      class="default-theme"
      :style="{ 'max-width': `${width}px`, 'height': `${height}px` }"
    >
      <pane min-size="5">
        <RDH
          :rdh="rdh"
          :width="width"
          :height="height"
          :readonly="false"
          :showOnlyChanged="showOnlyChanged"
          :withComment="rdh.keys.some((it) => it.comment?.length)"
          @onClickCell="onClickCell"
          :ref="setRdhRef"
        >
        </RDH>
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
