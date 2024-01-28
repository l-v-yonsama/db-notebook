<template>
  <div class="dropdown-action-container">
    <div class="monaco-dropdown">
      <div class="dropdown-label" :disabled="disabled">
        <a
          class="action-label codicon"
          :class="{ 'codicon-chevron-down': isChevron, 'codicon-ellipsis': isMore }"
          role="button"
          aria-haspopup="true"
          aria-expanded="false"
          :title="title"
          :aria-label="title"
          :disabled="disabled"
          @click="toggle"
        ></a>
      </div>
    </div>
    <section class="dropdown-list" v-click-outside-element="close" v-if="visibleContent">
      <template v-for="(item, idx) of items" :key="idx">
        <p v-if="item.kind == 'selection' && visibleItem(item)">
          <a @click="clickItem(item.value)">{{ item.label }}</a>
        </p>
        <hr v-if="item.kind == 'divider'" class="hr" />
      </template>
      <slot></slot>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { SecondaryItem, SecondaryItemSelection } from "@/types/Components";

const props = defineProps<{
  title: string;
  items: SecondaryItem[];
  disabled?: boolean;
}>();

const isChevron = ref(props.title != "more");
const isMore = ref(props.title == "more");

const emit = defineEmits<{
  (event: "onSelect", value: any): void;
}>();

const visibleContent = ref(false);
let beforeOpened = new Date().getTime();

const toggle = () => {
  visibleContent.value = !visibleContent.value;
  beforeOpened = new Date().getTime();
};

const close = () => {
  const now = new Date().getTime();
  if (now - beforeOpened < 400) {
    return;
  }
  visibleContent.value = false;
};

const visibleItem = (item: SecondaryItemSelection): boolean => {
  if (item && item.when) {
    return item.when();
  }
  return true;
};

function clickItem(value: any) {
  emit("onSelect", value);
  close();
}
</script>
<style lang="scss" scoped>
hr.hr {
  width: 100%;
}
a {
  color: inherit;
}
.dropdown-action-container {
  position: relative;
}
.dropdown-label {
  cursor: pointer;

  &[disabled="true"] {
    cursor: not-allowed;
  }
}
.dropdown-list {
  position: absolute;
  right: 10px;
  top: 28px;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  z-index: 10;
  padding: 3px;
  color: var(--input-foreground);
  box-sizing: border-box;
  background: var(--input-background);
  border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
}
.dropdown-list p {
  margin: 1px 0;
}
.dropdown-list a {
  text-align: right;
  display: block !important;
  background: transparent;
  height: inherit;
  flex-grow: 1;
  box-sizing: border-box;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  padding: var(--button-padding-vertical) var(--button-padding-horizontal);
  outline: none;
  text-decoration: none;
  color: inherit;
  border-radius: inherit;
  border: calc(var(--border-width) * 1px) solid var(--button-border);
  fill: inherit;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  font-family: var(--font-family);
  font-size: var(--type-ramp-base-font-size);
  line-height: var(--type-ramp-base-line-height);
}
.dropdown-list a:hover {
  color: var(--button-primary-foreground);
  background: var(--button-primary-background);
}
</style>
