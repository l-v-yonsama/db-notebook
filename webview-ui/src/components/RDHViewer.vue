<script setup lang="ts">
import type { CellFocusParams, ShowCellDetailParams, ShowRecordParams } from "@/types/RdhEvents";
import type { RdhViewConfig } from "@/utilities/vscode";
import { isJsonLike, type FileAnnotation, type ResultSetData } from "@l-v-yonsama/rdh";
import { computed, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import RDH from "./RDH.vue";

type Props = {
  width: number;
  height: number;
  rdh: ResultSetData;
  config: RdhViewConfig | null;
  showOnlyChanged?: boolean;
  showDetailPane?: boolean;
};

const props = defineProps<Props>();

const TR_HEIGHT = 25;

const rdhRef = ref<InstanceType<typeof RDH>>();
const setRdhRef = (el: any) => {
  rdhRef.value = el;
};
const showDetailPane = ref(props.showDetailPane ?? false);
const detailText = ref("");
const detailFileAnnotationValue = ref(undefined as FileAnnotation["values"] | undefined);

const contentHeight = computed(() => {
  const hasComment = props.rdh.keys.some((it) => it.comment?.length);
  const withComment = props.config?.displayComment;
  const withType = props.config?.displayType;
  const editable = props.rdh.meta?.editable === true;
  let div = 19;
  if (editable || (withComment && hasComment) && withType) {
    div += TR_HEIGHT * 3;
  } else if ((withComment && hasComment) || withType) {
    div += TR_HEIGHT * 2;
  } else {
    div += TR_HEIGHT;
  }

  return Math.max(props.height - div, 50)
});

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

function onShowRecordAtDetailPane(params: ShowRecordParams) {
  const { value } = params;
  detailText.value = JSON.stringify(value, null, 2);
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
    <splitpanes class="default-theme" :style="{ 'max-width': `${width}px`, 'height': `${height}px` }">
      <pane min-size="5" size="70">
        <RDH :rdh="rdh" :config="config" :width="width" :height="height" :showOnlyChanged="showOnlyChanged"
          @onClickCell="onClickCell" @onShowDetailPane="onShowDetailPane"
          @onShowRecordAtDetailPane="onShowRecordAtDetailPane" :ref="setRdhRef">
        </RDH>
      </pane>
      <pane v-if="showDetailPane" size="30">
        <section>
          <div class="toolbar">
            <VsCodeButton @click.stop="copyToClipboard" appearance="secondary" class="copy-to-clipboard"
              title="Copy to clipboard">
              <fa icon="clipboard" />
            </VsCodeButton>
            <VsCodeButton @click.stop="close" title="Close"><span class="codicon codicon-chrome-close"></span>
            </VsCodeButton>
          </div>
          <div class="contents" :style="{ height: `${contentHeight}px` }">
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
    overflow-y: auto;

    p {
      margin: 0;
      white-space: pre-wrap;
    }
  }
}
</style>
