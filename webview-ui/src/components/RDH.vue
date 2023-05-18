<script setup lang="ts">
import { ref, computed } from "vue";
import type { CellFocusParams } from "@/types/RdhEvents";
import * as GC from "@/types/lib/GeneralColumnType";
import dayjs from "dayjs";
import type { RdhKey, RdhRow, ResultSetDataHolder } from "@/types/lib/ResultSetDataHolder";
import { AnnotationType } from "@/types/lib/ResultSetDataHolder";

type Props = {
  rdh: ResultSetDataHolder;
  height: number;
  readonly: boolean;
};

const props = defineProps<Props>();

const containerHeight = computed((): string => {
  const n = props.height > 30 ? props.height - 30 : props.height;
  console.log("containerHeight", n);
  return `${n}px`;
});

const emit = defineEmits<{
  (event: "onCellFocus", value: CellFocusParams): void;
}>();

const columns = ref(
  props.rdh.keys.map((k) => {
    let type = "string";
    let width = k.width ?? 80;
    switch (k.type) {
      case GC.GeneralColumnType.BIT:
        type = "checkTF";
        break;
      case GC.GeneralColumnType.BIGINT:
      case GC.GeneralColumnType.MEDIUMINT:
      case GC.GeneralColumnType.INTEGER:
      case GC.GeneralColumnType.SMALLINT:
      case GC.GeneralColumnType.TINYINT:
      case GC.GeneralColumnType.FLOAT:
      case GC.GeneralColumnType.DOUBLE_PRECISION:
      case GC.GeneralColumnType.NUMERIC:
      case GC.GeneralColumnType.DECIMAL:
      case GC.GeneralColumnType.REAL:
        type = "number";
        break;
      case GC.GeneralColumnType.YEAR:
        width = 55;
        type = "number";
        break;
      case GC.GeneralColumnType.TIME:
      case GC.GeneralColumnType.TIME_WITH_TIME_ZONE:
        width = 75;
        break;
      case GC.GeneralColumnType.TIMESTAMP:
      case GC.GeneralColumnType.TIMESTAMP_WITH_TIME_ZONE:
        type = "datetimesec";
        width = 160;
        break;
      case GC.GeneralColumnType.DATE:
        width = 95;
        type = "string";
        break;
    }
    return {
      field: k.name,
      label: k.name,
      type,
      width,
    };
  })
);
const jsondata = ref(
  props.rdh.rows.map((row) => {
    const item: any = {};
    item["$meta"] = row.meta;
    props.rdh.keys.map((k) => {
      item[k.name] = toValue(k, row.values[k.name]);
    });
    return item;
  })
);
function toValue(key: RdhKey, value: any): any {
  if (value == undefined) {
    return value;
  }
  switch (key.type) {
    case GC.GeneralColumnType.BIT:
      return true ? "T" : "F";
    case GC.GeneralColumnType.TIMESTAMP:
    case GC.GeneralColumnType.TIMESTAMP_WITH_TIME_ZONE:
      return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
    case GC.GeneralColumnType.DATE:
      return dayjs(value).format("YYYY-MM-DD");
  }
  return value;
}

const onCellFocus = ({
  rowPos,
  colPos,
  cell,
}: {
  rowPos: number;
  colPos: number;
  cell: string;
}): void => {
  const colKey = columns.value[colPos].field;
  const rowValues = jsondata.value[rowPos];
  const value = rowValues[colKey];
  const params: CellFocusParams = {
    rowPos,
    colPos,
    cell,
    colKey,
    rowValues,
    value,
  };
  emit("onCellFocus", params);
};

const hasAnnotationsOf = (meta: RdhRow["meta"], type: AnnotationType, key?: string): boolean => {
  if (!meta) {
    return false;
  }
  if (key) {
    return meta[key]?.some((it) => it.type == type) ?? false;
  }
  return (
    Object.values(meta)
      ?.flat()
      ?.some((it) => it.type == type) ?? false
  );
};

const cellStyle = (p: any, keyInfo: any): any => {
  const meta: RdhRow["meta"] = p["$meta"];
  if (hasAnnotationsOf(meta, AnnotationType.Upd, keyInfo.name)) {
    return { "background-color": "rgba(112, 83, 255, 0.29) !important" };
  }
  return {};
};

const rowStyle = (p: any): any => {
  const meta: RdhRow["meta"] = p["$meta"];
  if (hasAnnotationsOf(meta, AnnotationType.Add)) {
    return { "background-color": "rgba(195, 232, 141, 0.22) !important" };
  } else if (hasAnnotationsOf(meta, AnnotationType.Del)) {
    return { "background-color": "rgba(255, 83, 112, 0.25) !important" };
  } else if (hasAnnotationsOf(meta, AnnotationType.Upd)) {
    return { "background-color": "rgba(112, 83, 255, 0.11) !important" };
  }
  return null;
};
</script>

<template>
  <section>
    <vue-excel-editor
      ref="grid"
      v-model="jsondata"
      :no-paging="true"
      :row-style="rowStyle"
      :cell-style="cellStyle"
      :height="containerHeight"
      :no-mouse-scroll="true"
      :readonly="readonly"
      @cell-focus="onCellFocus"
    >
      <vue-excel-column
        v-for="(key, idx) of columns"
        :key="idx"
        :field="key.field"
        :label="key.label"
        :type="key.type"
        :width="`${key.width}px`"
      />
    </vue-excel-editor>
  </section>
</template>

<style>
table.systable tbody tr {
  background-color: inherit !important;
}
table.systable thead th {
  background-color: var(--background) !important;
}
table.systable th.first-col,
table.systable td.first-col {
  background-color: var(--background) !important;
}
.vue-excel-editor .footer {
  background-color: inherit !important;
  color: inherit !important;
}
.vue-excel-editor .footer > div,
.vue-excel-editor .footer > span {
  background-color: inherit !important;
  color: inherit !important;
}
.vue-excel-editor .footer > div.h-scroll {
  background-color: var(--vscode-dropdown-background) !important;
  color: var(--vscode-dropdown-foreground) !important;
  border-color: var(--vscode-dropdown-border) !important;
  border-radius: 3px;
}
table.systable tbody tr.inserted {
  background-color: var(--vscode-diffEditor-insertedTextBackground) !important;
}
table.systable tbody tr.removed {
  background-color: var(--vscode-diffEditor-removedTextBackground) !important;
}
</style>
