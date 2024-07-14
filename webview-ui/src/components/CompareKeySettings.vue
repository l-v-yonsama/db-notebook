<script setup lang="ts">
import type { CompareKey, RdhMeta, ResultSetData } from "@l-v-yonsama/rdh";
import { computed, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeCheckboxGroup from "./base/VsCodeCheckboxGroup.vue";

type Props = {
  rdhList: ResultSetData[];
};
const props = defineProps<Props>();

const emit = defineEmits<{
  (event: "cancel"): void;
  (
    event: "save",
    values: {
      index: number;
      compareKeyNames: string[];
    }[]
  ): void;
}>();

type Item = {
  index: number;
  keys: string[];
  meta: RdhMeta;
  initializedAtEdit: boolean;
  showEditor: boolean;
  dirty: boolean;
};
const list = ref(
  props.rdhList.map(
    (rdh, idx): Item => ({
      index: idx,
      keys: rdh.keys.map((it) => it.name),
      meta: rdh.meta,
      initializedAtEdit: false,
      showEditor: false,
      dirty: false,
    })
  )
);

const compareKeyCheckboxSelected = ref([] as string[]);

const compareKeyCheckboxItems = ref(
  [] as { label: string; value: string; disabled?: boolean; checked?: boolean }[]
);

const dirty = computed(() => list.value.some((it) => it.dirty));

function displayCompareKeys(keys?: CompareKey[]) {
  if (!keys || keys.length === 0) {
    return "No compare keys";
  }
  return keys.map((it) => `${it.kind} keys: ${it.names.join(",")}`).join(", ");
}

const clear = (item: Item) => {
  item.dirty = true;
  if (item.meta.compareKeys == undefined) {
    item.meta.compareKeys = [];
  } else {
    item.meta.compareKeys.splice(0, item.meta.compareKeys.length);
  }
  item.showEditor = false;
};

const edit = (item: Item) => {
  if (!item.initializedAtEdit) {
    compareKeyCheckboxSelected.value.splice(0, compareKeyCheckboxSelected.value.length);
    const rdhKeys = new Set<string>();
    item.meta.compareKeys?.forEach((ckey) => {
      item.keys.forEach((rdhKeyName) => {
        if (
          ckey.names.some((ckName) => ckName.toLocaleLowerCase() == rdhKeyName.toLocaleLowerCase())
        ) {
          rdhKeys.add(rdhKeyName);
        }
      });
    });
    compareKeyCheckboxSelected.value.push(...rdhKeys);
    item.initializedAtEdit = true;
  }
  compareKeyCheckboxItems.value.splice(0, compareKeyCheckboxItems.value.length);
  item.keys.forEach((key) => {
    compareKeyCheckboxItems.value.push({
      label: key,
      value: key,
      checked: compareKeyCheckboxSelected.value.includes(key),
    });
  });

  item.showEditor = true;
};

const cancel = () => {
  emit("cancel");
};

const cancelEdit = (item: Item) => {
  item.showEditor = false;
};

const accept = (item: Item) => {
  item.dirty = true;
  if (item.meta.compareKeys == undefined) {
    item.meta.compareKeys = [];
  }
  item.meta.compareKeys.splice(0, item.meta.compareKeys.length);
  item.meta.compareKeys.push({
    kind: "custom",
    names: [...compareKeyCheckboxSelected.value],
  });
  item.showEditor = false;
};

const save = () => {
  const values = list.value
    .filter((it) => it.dirty)
    .map((it) => {
      const compareKeyNames: string[] = [];
      if (it.meta?.compareKeys) {
        it.meta.compareKeys.forEach((key) => {
          compareKeyNames.push(...key.names);
        });
      }
      return {
        index: it.index,
        compareKeyNames,
      };
    });
  emit("save", values);
};
</script>

<template>
  <section>
    <div class="toolbar">
      <VsCodeButton @click="cancel" appearance="secondary" title="Cancel">Cancel</VsCodeButton>
      <VsCodeButton :disabled="!dirty" @click="save" title="Save compare keys">Save</VsCodeButton>
    </div>
    <table class="table">
      <thead>
        <tr>
          <th>ROW</th>
          <th>Title (Table)</th>
          <th>Comment</th>
          <th>Compare keys (Primary key, Unique key or custom key)</th>
          <th class="control">Control</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(item, idx) of list" :key="idx">
          <tr>
            <td>{{ idx + 1 }}</td>
            <td>{{ item.meta.tableName ?? "" }}</td>
            <td>{{ item.meta.comment ?? "" }}</td>
            <td>{{ displayCompareKeys(item.meta.compareKeys) }}</td>
            <td>
              <VsCodeButton
                v-if="!item.showEditor"
                @click="clear(item)"
                appearance="secondary"
                title="Clear compare keys"
                >Clear</VsCodeButton
              >
              <VsCodeButton v-if="!item.showEditor" @click="edit(item)" title="Edit compare keys"
                >Edit</VsCodeButton
              >
            </td>
          </tr>
          <tr v-if="item.showEditor">
            <td colspan="4">
              <VsCodeCheckboxGroup
                legend="Compare keys"
                :items="compareKeyCheckboxItems"
                v-model="compareKeyCheckboxSelected"
              />
            </td>
            <td>
              <VsCodeButton @click="cancelEdit(item)" appearance="secondary" title="Cancel"
                >Cancel</VsCodeButton
              >
              <VsCodeButton @click="accept(item)" title="Ok">Ok</VsCodeButton>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.toolbar {
  padding: 3px 4px;
  margin-bottom: 13px;
  text-align: right;
}
table {
  border-collapse: collapse;
  width: 100%;
}

thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: var(--vscode-editorPane-background);
}
tr {
  border-top: calc(var(--border-width) * 1px) solid var(--dropdown-border);
  border-bottom: calc(var(--border-width) * 1px) solid var(--dropdown-border);
}
td {
  text-align: center;
}
th {
  height: 20px;
  padding: 2px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.control {
  width: 110px;
  max-width: 110px;
}
</style>
