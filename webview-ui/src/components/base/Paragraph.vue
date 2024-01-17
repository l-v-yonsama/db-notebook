<template>
  <p>
    <span
      v-for="(item, index) in items"
      :key="index"
      :class="{ highlighted: item.isHighlighted }"
      v-text="item.text"
    ></span>
  </p>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    text: string;
    highlightText: string;
  }>(),
  {
    text: "",
    highlightText: "",
  }
);

type Item = {
  text: string;
  isHighlighted: boolean;
};
const items = computed(() => {
  const list: Item[] = [];
  const pt = props.text + "";
  const h = props.highlightText?.toLocaleLowerCase() ?? "";
  if (h.length > 0 && pt.length > 0) {
    let s = pt.toLocaleLowerCase();
    let prevPos = 0;
    let pos = 0;
    while ((pos = s.indexOf(h, prevPos)) >= 0) {
      if (prevPos < pos) {
        const text = pt.substring(prevPos, pos);
        list.push({ text, isHighlighted: false });
      }
      list.push({ text: pt.substring(pos, pos + h.length), isHighlighted: true });
      prevPos = pos + h.length;
    }
    if (prevPos < s.length) {
      const text = pt.substring(prevPos);
      list.push({ text, isHighlighted: false });
    }
  } else {
    list.push({ text: pt, isHighlighted: false });
  }
  return list;
});
</script>
<style scoped>
p {
  margin: 1px;
}
</style>
