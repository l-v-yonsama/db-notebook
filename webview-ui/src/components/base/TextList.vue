<template>
  <div class="text-list">
    <div>
      <label :for="id">{{ label }}</label>
      <VsCodeButton v-if="!isShowMode" @click.stop="add" title="Add" style="margin-left:3px">
        <fa icon="plus" size="sm" />Add
      </VsCodeButton>
    </div>
    <ul v-if="isShowMode">
      <li v-for="(v, idx) of inputValue" :key="idx" v-text="abbr(v, 60)" :title="v"></li>
    </ul>
    <table v-else class="bordered">
      <tbody>
        <tr v-for="(v, idx) of inputValue" :key="idx">
          <td>
            <VsCodeButton @click.stop="remove(idx)" appearance="secondary" title="Del">
              <fa icon="trash" size="sm" />
            </VsCodeButton>
          </td>
          <td>
            <vscode-text-field class="child" :value="v" :placeholder="placeholder" :maxlength="256"
              @change="updateText($event.target?.value ?? '', idx)"></vscode-text-field>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { abbr } from "@l-v-yonsama/rdh";
import { provideVSCodeDesignSystem, vsCodeTextField } from "@vscode/webview-ui-toolkit";
import { computed } from "vue";
import VsCodeButton from "./VsCodeButton.vue";

provideVSCodeDesignSystem().register(vsCodeTextField());

const props = defineProps<{
  modelValue: string[];
  label: string;
  placeholder: string;
  isShowMode: boolean;
  showModeValue?: string;
  id: string;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", modelValue: string[]): void;
}>();

const updateText = (v: string, idx: number) => {
  inputValue.value[idx] = v;
}

const add = () => {
  inputValue.value.push('');
};

const remove = (idx: number) => {
  inputValue.value.splice(idx, 1);
};

const inputValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

</script>
<style lang="scss" scoped>
div.text-list {

  label {
    margin: 0.5rem 0 1px 0;
  }

  ul {
    margin-top: 5px;
    margin-bottom: 3px;
    padding-inline-start: 20px;

    li {
      opacity: 0.7;
    }
  }
}
</style>
