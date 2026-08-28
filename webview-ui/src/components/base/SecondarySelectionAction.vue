<template>
  <div class="dropdown-action-container" :class="{ open: visibleContent }">
    <div class="monaco-dropdown">
      <div class="dropdown-label">
        <a
          class="action-label"
          :class="{ 'has-label': !!label, disabled }"
          role="button"
          :title="title"
          :aria-label="label ? undefined : title"
          @click="toggle"
        >
          <span v-if="label" class="label-text">{{ label }}</span>
          <span class="codicon" :class="{ 'codicon-chevron-down': isChevron, 'codicon-ellipsis': isMore }"></span>
        </a>
      </div>
    </div>
    <section
      ref="dropdownList"
      class="dropdown-list"
      v-click-outside-element="close"
      v-if="visibleContent"
      :style="{ transform: `translateX(${menuOffsetX}px)` }"
    >
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
import type { SecondaryItem, SecondaryItemSelection } from "@/types/Components";
import { computed, nextTick, ref } from "vue";

const props = defineProps<{
  title: string;
  items: SecondaryItem[];
  disabled?: boolean;
  // Optional visible text before the chevron/ellipsis icon (e.g. "Export").
  // Without it this renders exactly as before - a bare icon whose accessible
  // name comes from `title` - so every existing call site (a small "more
  // options" chevron placed next to its own separate primary button) is
  // unaffected.
  label?: string;
}>();

const isChevron = computed(() => props.title != "more");
const isMore = computed(() => props.title == "more");

const emit = defineEmits<{
  (event: "onSelect", value: any): void;
}>();

const visibleContent = ref(false);
const dropdownList = ref<HTMLElement>();
const menuOffsetX = ref(0);
let beforeOpened = new Date().getTime();

const keepMenuInViewport = () => {
  const element = dropdownList.value;
  if (!element) {
    return;
  }
  const viewportPadding = 6;
  const rect = element.getBoundingClientRect();
  let offset = 0;
  if (rect.left < viewportPadding) {
    offset += viewportPadding - rect.left;
  }
  if (rect.right + offset > window.innerWidth - viewportPadding) {
    offset -= rect.right + offset - (window.innerWidth - viewportPadding);
  }
  menuOffsetX.value = Math.round(offset);
};

const toggle = async () => {
  if (props.disabled) {
    return;
  }
  visibleContent.value = !visibleContent.value;
  beforeOpened = new Date().getTime();
  menuOffsetX.value = 0;
  if (visibleContent.value) {
    await nextTick();
    keepMenuInViewport();
  }
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

  // VsCodeDropdown raises its web component to z-index 200 while focused.
  // Lift the whole action (not only its child menu) into a higher stacking
  // context while open so later dropdowns cannot paint over this menu.
  &.open {
    z-index: 1000;
  }
}
.dropdown-label {
  cursor: pointer;
}
.action-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}
// Only the labeled form (e.g. "Export ▾") gets button-like chrome - the
// bare-icon form used everywhere else keeps its original unboxed look.
.action-label.has-label {
  padding: var(--button-padding-vertical) var(--button-padding-horizontal);
  color: var(--input-foreground);
  background: var(--input-background);
  border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
  border-radius: 2px;

  &:not(.disabled):hover {
    background: var(--vscode-toolbar-hoverBackground);
  }
}
.label-text {
  font-family: var(--font-family);
  font-size: var(--type-ramp-base-font-size);
  line-height: var(--type-ramp-base-line-height);
}
.dropdown-list {
  position: absolute;
  right: 10px;
  top: 28px;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  z-index: 1001;
  padding: 3px;
  color: var(--input-foreground);
  box-sizing: border-box;
  background: var(--input-background);
  border: calc(var(--border-width) * 1px) solid var(--dropdown-border);
  max-width: calc(100vw - 12px);
  overflow-x: auto;
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
