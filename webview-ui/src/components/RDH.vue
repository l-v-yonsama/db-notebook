<script setup lang="ts">
import { ref, computed } from "vue";
import type { CellFocusParams } from "@/types/RdhEvents";
import * as GC from "@/types/lib/GeneralColumnType";
import {
  isNumericLike,
  isDateTimeOrDateOrTime,
  isDateTimeOrDate,
  isArray,
  isBinaryLike,
  isBooleanLike,
  isEnumOrSet,
  isJsonLike,
  isTextLike,
} from "@/utilities/GeneralColumnUtil";
import dayjs from "dayjs";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import type {
  ResultSetData,
  RdhRow,
  RdhKey,
  AnnotationType,
  RuleAnnotation,
} from "@l-v-yonsama/multi-platform-database-drivers";

type Props = {
  rdh: ResultSetData;
  width: number;
  height: number;
  readonly: boolean;
  withComment: boolean;
  showOnlyChanged?: boolean;
};

const props = defineProps<Props>();

type RowValues = {
  $meta: RdhRow["meta"];
  [key: string]: any;
};

type ColKey = {
  name: string;
  type: string;
  typeClass: string;
  width: number;
  inputSize: number;
  comment: string;
};

const emit = defineEmits<{
  (event: "onCellFocus", value: CellFocusParams): void;
}>();

const columns = ref(
  props.rdh.keys.map((k) => {
    let type = "string";
    let typeClass = "codicon-circle-outline";
    let width = k.width ?? 100;

    if (isNumericLike(k.type)) {
      typeClass = "codicon-symbol-numeric";
      type = "number";
      if (k.type == GC.GeneralColumnType.YEAR) {
        width = 55;
      }
    } else if (isDateTimeOrDateOrTime(k.type)) {
      typeClass = "codicon-calendar";
      width = 160;
      if (isDateTimeOrDate(k.type)) {
        if (k.type == GC.GeneralColumnType.DATE) {
          width = 96;
        }
      } else {
        // time
        width = 72;
      }
    } else if (isArray(k.type)) {
      typeClass = "codicon-symbol-array";
    } else if (isBinaryLike(k.type)) {
      typeClass = "codicon-file-binary";
    } else if (isBooleanLike(k.type)) {
      typeClass = "codicon-symbol-boolean";
      type = "codicon-checkTF";
    } else if (isEnumOrSet(k.type)) {
      typeClass = "codicon-symbol-enum";
    } else if (isJsonLike(k.type)) {
      typeClass = "codicon-json";
    } else if (isTextLike(k.type)) {
      typeClass = "codicon-symbol-string";
    }

    const key: ColKey = {
      name: k.name,
      type,
      typeClass,
      width,
      inputSize: Math.ceil(width / 8),
      comment: k.comment,
    };
    return key;
  })
);
const list = ref(
  props.rdh.rows
    .filter(
      (it) =>
        props.showOnlyChanged == undefined ||
        props.showOnlyChanged === false ||
        hasAnyChangedAnnotation(it.meta)
    )
    .map((row) => {
      const item: RowValues = {
        $meta: row.meta,
      };
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
  key,
  rowValues,
}: {
  rowPos: number;
  colPos: number;
  key: string;
  rowValues: RowValues;
}): void => {
  const value = rowValues[key];
  const params: CellFocusParams = {
    rowPos,
    colPos,
    key,
    rowValues,
    value,
  };
  emit("onCellFocus", params);
};

function hasAnyChangedAnnotation(meta: RdhRow["meta"]): boolean {
  if (!meta) {
    return false;
  }
  return (
    Object.values(meta)
      ?.flat()
      ?.some((it) => it.type == "Add" || it.type == "Del" || it.type == "Upd") ?? false
  );
}

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

const cellStyle = (p: any, keyInfo: ColKey): any => {
  const styles: any = {
    width: `${keyInfo.width}px`,
  };
  const meta: RdhRow["meta"] = p["$meta"];
  if (hasAnnotationsOf(meta, "Upd", keyInfo.name)) {
    styles["background-color"] = "rgba(112, 83, 255, 0.29) !important";
  }
  if (hasAnnotationsOf(meta, "Rul", keyInfo.name)) {
    styles["background-color"] = "rgba(232, 232, 83, 0.21) !important";
  }
  return styles;
};

const rowStyle = (p: any): any => {
  const meta: RdhRow["meta"] = p["$meta"];
  if (hasAnnotationsOf(meta, "Add")) {
    return { "background-color": "rgba(195, 232, 141, 0.22) !important" };
  } else if (hasAnnotationsOf(meta, "Del")) {
    return { "background-color": "rgba(255, 83, 112, 0.25) !important" };
  } else if (hasAnnotationsOf(meta, "Upd")) {
    return { "background-color": "rgba(112, 83, 255, 0.11) !important" };
  } else if (hasAnnotationsOf(meta, "Rul")) {
    return { "background-color": "rgba(232, 232, 83, 0.09) !important" };
  }
  return null;
};

const toTitle = (item: RowValues, key: string): string => {
  const meta: RdhRow["meta"] = item["$meta"];
  const rule = meta[key]?.find((it) => it.type === "Rul") as RuleAnnotation;
  if (rule && rule.values && rule.values?.message) {
    return rule.values.message;
  }
  return item[key];
};
</script>

<template>
  <section class="table">
    <VirtualList :items="list" table class="list-table" :style="{ height: `${height}px` }">
      <template #prepend>
        <thead>
          <tr>
            <th>ROW</th>
            <th
              v-for="(key, idx) of columns"
              :key="idx"
              :title="key.name"
              :style="{ width: `${key.width}px` }"
            >
              <span class="codicon" :class="key.typeClass"></span
              ><span
                class="label"
                :style="{ 'width': `${key.width - 18}px`, 'max-width': `${key.width - 18}px` }"
                >{{ key.name }}</span
              >
              <a class="widen" @click="key.width += 100"
                ><span class="codicon codicon-arrow-both"></span
              ></a>
            </th>
          </tr>
          <tr v-if="withComment">
            <th>&nbsp;</th>
            <th
              v-for="(key, idx) of columns"
              :key="idx"
              :style="{ 'width': `${key.width}px`, 'max-width': `${key.width}px` }"
              :title="key.comment"
            >
              {{ key.comment }}
            </th>
          </tr>
        </thead>
      </template>
      <template #default="{ item, index }">
        <tr :style="rowStyle(item)">
          <td>
            {{ index + 1 }}
          </td>
          <td v-for="(key, idx) of columns" :key="idx" :style="cellStyle(item, key)">
            <VsCodeTextField
              v-model="item[key.name]"
              :readonly="false"
              :transparent="true"
              :maxlength="1000"
              :size="key.inputSize"
              :title="toTitle(item, key.name)"
              style="width: 99%"
              @onCellFocus="
                onCellFocus({ rowPos: index, colPos: idx, key: key.name, rowValues: item })
              "
            ></VsCodeTextField>
          </td>
        </tr>
      </template>
    </VirtualList>
  </section>
</template>

<style>
.list-table table {
  border-collapse: collapse;
  width: 100%;
}
</style>
<style scoped>
thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: var(--vscode-editorPane-background);
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
  position: relative;
}

th > a.widen {
  cursor: pointer;
  display: none;
  position: absolute;
  right: 2px;
  top: 2px;
}
th:hover > a.widen {
  display: inline-block;
}

thead th:first-child,
tbody td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 50px;
  width: 50px;
  background-color: var(--vscode-editorPane-background);
}
tbody td:first-child {
  text-align: right;
  padding-right: 5px;
}

span.codicon {
  margin-right: 2px;
  vertical-align: middle;
}
span.label {
  display: inline-block;
  vertical-align: middle;
  height: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.scroller {
  height: 100%;
}
/* tr.inserted {
  background-color: var(--vscode-diffEditor-insertedTextBackground) !important;
}
tr.removed {
  background-color: var(--vscode-diffEditor-removedTextBackground) !important;
} */
</style>
