<script setup lang="ts">
import { ref } from "vue";
import type { ResultSetData, FileAnnotation } from "@l-v-yonsama/multi-platform-database-drivers";
import FileAnnotationView from "./base/FileAnnotationView.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import RDH from "./RDH.vue";
import type { CellFocusParams, ShowCellDetailParams } from "@/types/RdhEvents";
import { isJsonLike } from "@/utilities/GeneralColumnUtil";

type Props = {
  width: number;
  height: number;
  rdh: ResultSetData;
  readonly: boolean;
  showOnlyChanged?: boolean;
  showDetailPane?: boolean;
};

const props = defineProps<Props>();

const rdhRef = ref<InstanceType<typeof RDH>>();
const setRdhRef = (el: any) => {
  rdhRef.value = el;
};
const showDetailPane = ref(props.showDetailPane ?? false);
const detailText = ref("");
const detailFileAnnotationValue = ref(undefined as FileAnnotation["values"] | undefined);

const emit = defineEmits<{
  (event: "onClickCell", value: CellFocusParams): void;
}>();

function onClickCell(params: CellFocusParams) {
  emit("onClickCell", params);
}

function onShowDetailPane(params: ShowCellDetailParams) {
  const { gtype, value } = params;
  let text = "";
  if (isJsonLike(gtype) && value) {
    let o = value;
    if (typeof value === "string") {
      o = JSON.parse(value);
    }
    text = JSON.stringify(o, null, 2);
  } else {
    text = value + "";
  }
  detailText.value = text;
  showDetailPane.value = true;
}

const save = (): any => {
  return rdhRef.value?.save();
};

const copyToClipboard = () => {
  navigator?.clipboard?.writeText(detailText.value);
};

const close = () => {
  detailText.value = "";
  detailFileAnnotationValue.value = undefined;
  showDetailPane.value = false;
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
      <pane min-size="5" size="70">
        <RDH
          :rdh="rdh"
          :width="width"
          :height="height"
          :readonly="false"
          :showOnlyChanged="showOnlyChanged"
          :withComment="rdh.keys.some((it) => it.comment?.length)"
          @onClickCell="onClickCell"
          @onShowDetailPane="onShowDetailPane"
          :ref="setRdhRef"
        >
        </RDH>
      </pane>
      <pane v-if="showDetailPane" size="30">
        <section>
          <div class="toolbar">
            <VsCodeButton
              @click.stop="copyToClipboard"
              appearance="secondary"
              class="copy-to-clipboard"
              ><fa icon="clipboard"
            /></VsCodeButton>
            <VsCodeButton @click.stop="close" title="Close"
              ><span class="codicon codicon-chrome-close"></span
            ></VsCodeButton>
          </div>
          <div class="contents">
            <p v-if="detailText">{{ detailText }}</p>
          </div>
        </section>
      </pane>
    </splitpanes>
  </section>
</template>

<style lang="scss" scoped>
section {
  display: block;
  width: 100%;
  .toolbar {
    column-gap: 2px;
    justify-content: flex-end;
  }
  .contents {
    padding: 0px 2px;
    white-space: pre-wrap;
  }
}
</style>
