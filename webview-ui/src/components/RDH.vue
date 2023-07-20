<script setup lang="ts">
import { ref, nextTick, computed } from "vue";
import type { CellFocusParams } from "@/types/RdhEvents";
import * as GC from "@/types/lib/GeneralColumnType";
import VsCodeButton from "./base/VsCodeButton.vue";
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
import type {
  EditRowInsertValues,
  EditRowUpdateValues,
  EditRowDeleteValues,
  SaveValuesInRdhParams,
} from "@/utilities/vscode";
import dayjs from "dayjs";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import type {
  CodeResolvedAnnotation,
  ResultSetData,
  RdhRow,
  RdhKey,
  AnnotationType,
  RuleAnnotation,
  CompareKey,
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

type RowEditType = "del" | "upd" | "ins";

type RowValues = {
  editType?: RowEditType;
  $meta: RdhRow["meta"];
  [key: string]: any;

  $ruleViolationMarks: {
    [key: string]: string | undefined;
  };
  $resolvedLabels: {
    [key: string]: any;
  };
  $beforeKeyValues?: {
    [key: string]: any;
  };
  $beforeValues?: {
    [key: string]: any;
  };
};

type ColKey = {
  name: string;
  type: string;
  typeClass: string;
  width: number;
  inputSize: number;
  comment: string;
  required?: boolean;
};

const editable = props.rdh.meta?.editable === true;

const emit = defineEmits<{
  (event: "onCellFocus", value: CellFocusParams): void;
}>();

const visible = ref(true);

let compareKey: CompareKey | undefined = undefined;
if (props.rdh.meta?.compareKeys?.length) {
  compareKey = props.rdh.meta.compareKeys.find((it) => it.kind === "primary");
  if (compareKey === undefined) {
    compareKey = props.rdh.meta.compareKeys[0];
  }
}

const { ruleViolationSummary } = props.rdh.meta;

const legend = ruleViolationSummary
  ? Object.keys(ruleViolationSummary)
      .map((k, idx) => `*${idx + 1}: ${k}: ${ruleViolationSummary[k]}`)
      .join(" , ")
  : "";

const height = computed(() => (legend.length > 0 ? Math.max(props.height - 16, 0) : props.height));

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
      required: k.required,
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
        $resolvedLabels: {},
        $ruleViolationMarks: {},
      };
      if (editable && compareKey) {
        item.$beforeKeyValues = {};
        compareKey.names.forEach((it) => {
          item.$beforeKeyValues![it] = row.values[it];
        });
        item.$beforeValues = {};
      }
      props.rdh.keys.map((k) => {
        item[k.name] = toValue(k, row.values[k.name]);
        if (item.$beforeValues) {
          item.$beforeValues[k.name] = item[k.name];
        }
        if (props.rdh.meta?.codeItems) {
          const meta = row.meta;
          const code = meta[k.name]?.find((it) => it.type === "Cod") as CodeResolvedAnnotation;
          item.$resolvedLabels[k.name] = code?.values?.label;
        }
        if (ruleViolationSummary) {
          const meta: RdhRow["meta"] = item["$meta"];
          const rules = meta[k.name]?.filter((it) => it.type === "Rul") as RuleAnnotation[];
          if (rules && rules.length) {
            const marks: number[] = [];
            const names = Object.keys(ruleViolationSummary);
            names.forEach((it, idx) => {
              if (rules.some((rule) => rule.values?.name === it)) {
                marks.push(idx + 1);
              }
            });
            let legend = marks.length > 0 ? `*${marks.join(",")}` : undefined;
            if (legend) {
              item.$ruleViolationMarks[k.name] = legend;
            }
          }
        }
      });
      return item;
    })
);

const addRow = (): void => {
  const empty: RowValues = {
    editType: "ins",
    $meta: {},
    $resolvedLabels: {},
    $ruleViolationMarks: {},
  };
  props.rdh.keys.map((k) => {
    empty[k.name] = "";
  });
  list.value.push(empty);
  visible.value = false;
  nextTick(() => (visible.value = true));
};

const editRow = (index: number): void => {
  list.value[index].editType = "upd";
  visible.value = false;
  nextTick(() => (visible.value = true));
};

const deleteRow = (index: number): void => {
  const curEditType = list.value[index].editType;
  if (curEditType === "ins") {
    list.value.splice(index, 1);
  } else {
    list.value[index].editType = "del";
  }
  visible.value = false;
  nextTick(() => (visible.value = true));
};

function toValue(key: RdhKey, value: any): any {
  if (value == undefined) {
    return value;
  }
  switch (key.type) {
    case GC.GeneralColumnType.BIT:
      return value === true ? "T" : "F";
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

const toEditTypeMark = (editType?: RowValues["editType"]): string => {
  if (editType === undefined) {
    return "";
  }
  switch (editType) {
    case "ins":
      return "+";
    case "upd":
      return "*";
    case "del":
      return "-";
  }
};

const copyToClipboard = (text: string) => {
  navigator?.clipboard?.writeText(text);
};

const save = (): SaveValuesInRdhParams => {
  console.log("calledd save");
  const params: SaveValuesInRdhParams = {
    insertList: [],
    updateList: [],
    deleteList: [],
    ok: true,
    message: "",
  };

  list.value
    .filter((it) => it.editType === "ins" || it.editType === "upd")
    .some((it) => {
      const missingValueColumns = columns.value.filter(
        (c) => c.required === true && (it[c.name] === undefined || it[c.name] === "")
      );
      if (missingValueColumns.length) {
        const column = missingValueColumns[0];
        let comment = "";
        if (column.comment) {
          comment = ` (${column.comment})`;
        }
        params.message = `Set the value in column '${column.name}'${comment}`;
        params.ok = false;
        return true;
      }
      return false;
    });

  params.insertList = list.value
    .filter((it) => it.editType === "ins")
    .map((it) => {
      let o: EditRowInsertValues = {
        values: {},
      };
      columns.value
        .map((c) => c.name)
        .forEach((key) => {
          o.values[key] = it[key];
        });
      return o;
    });

  params.updateList = list.value
    .filter((it) => {
      if (it.editType !== "upd") {
        return false;
      }
      if (it.$beforeValues === undefined) {
        return false;
      }
      return Object.keys(it.$beforeValues).some((k) => it.$beforeValues![k] != it[k]);
    })
    .map((it) => {
      let o: EditRowUpdateValues = {
        values: {},
        conditions: it.$beforeKeyValues ?? {},
      };
      Object.keys(it.$beforeValues!)
        .filter((k) => it.$beforeValues![k] != it[k])
        .forEach((k) => (o.values[k] = it[k]));
      return o;
    });

  params.deleteList = list.value
    .filter((it) => it.editType === "del")
    .map((it) => {
      let o: EditRowDeleteValues = {
        conditions: it.$beforeKeyValues ?? {},
      };
      return o;
    });

  if (
    params.deleteList.length === 0 &&
    params.updateList.length === 0 &&
    params.insertList.length === 0
  ) {
    params.message = "No changes";
    params.ok = false;
  }

  return JSON.parse(JSON.stringify(params));
};

defineExpose({
  save,
});
</script>

<template>
  <section>
    <section class="table" :class="{ readonly: !editable }">
      <VirtualList
        v-if="visible"
        :items="list"
        :table="true"
        class="list-table"
        :style="{ height: `${height}px` }"
      >
        <template #prepend>
          <thead>
            <tr>
              <th v-if="editable" class="ctrl">CONTROL</th>
              <th class="row">ROW</th>
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
            <tr v-if="withComment || editable">
              <th v-if="editable" class="ctrl">
                <div style="display: flex !important">
                  <VsCodeButton
                    v-if="editable"
                    @click="addRow"
                    title="Add row"
                    appearance="secondary"
                    ><fa icon="plus" />Add</VsCodeButton
                  >
                </div>
              </th>
              <th class="row"></th>
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
            <td v-if="editable" class="ctrl">
              <div>
                <VsCodeButton
                  v-if="editable"
                  :disabled="item.editType === 'ins'"
                  @click="editRow(index)"
                  title="Update row"
                  appearance="secondary"
                  ><fa icon="pencil"
                /></VsCodeButton>
                <VsCodeButton
                  v-if="editable"
                  @click="deleteRow(index)"
                  title="Delete row"
                  appearance="secondary"
                  ><fa icon="trash"
                /></VsCodeButton>
              </div>
            </td>
            <td class="row">
              {{ toEditTypeMark(item.editType) }}
              {{ index + 1 }}
            </td>
            <td
              class="vcell"
              v-for="(key, idx) of columns"
              :key="idx"
              :style="cellStyle(item, key)"
            >
              <VsCodeTextField
                v-if="item.editType === 'ins' || item.editType === 'upd'"
                v-model="item[key.name]"
                :readonly="false"
                :required="key.required"
                :transparent="true"
                :maxlength="1000"
                :size="key.inputSize"
                style="width: 99%"
                @onCellFocus="
                  onCellFocus({ rowPos: index, colPos: idx, key: key.name, rowValues: item })
                "
              ></VsCodeTextField>
              <template v-else>
                <p :style="{ width: `${key.width}px` }">
                  <span v-if="item.$ruleViolationMarks[key.name]" class="violation-mark">{{
                    item.$ruleViolationMarks[key.name]
                  }}</span
                  >{{ item[key.name] }}
                </p>
                <span v-if="item.$resolvedLabels[key.name]" class="code-label">{{
                  item.$resolvedLabels[key.name]
                }}</span>
                <VsCodeButton
                  v-if="
                    item[key.name] !== undefined && item[key.name] !== null && item[key.name] !== ''
                  "
                  @click="copyToClipboard(item[key.name])"
                  appearance="secondary"
                  class="copy-to-clipboard"
                  ><fa icon="clipboard"
                /></VsCodeButton>
              </template>
            </td>
          </tr>
        </template>
      </VirtualList>
    </section>
    <p v-if="legend.length" class="rule-violation-legend" v-text="legend"></p>
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

td,
th {
  border-right: calc(var(--border-width) * 1px) groove var(--dropdown-border);
  border-bottom: calc(var(--border-width) * 1px) groove var(--dropdown-border);
}

.row,
.ctrl {
  min-width: 80px;
  width: 80px;
  max-width: 80px;
}

.ctrl > div {
  display: none;
}
.ctrl:hover > div {
  display: flex;
  flex-direction: row;
  column-gap: 3px;
}
.ctrl > div > vscode-button {
  flex: 1;
}

td {
  text-align: center;
}
td.vcell {
  position: relative;
}
td.vcell > .code-label {
  display: inline-block;
  position: absolute;
  right: 4px;
  top: 4px;
  background-color: var(--vscode-editorPane-background);
  border: 1px solid var(--vscode-diffEditor-removedTextBackground);
  border-radius: 3px;
  padding: 1px;
}
td.vcell:hover > .code-label {
  display: none;
}
td.vcell > .copy-to-clipboard {
  display: none;
  position: absolute;
  right: 4px;
  top: 4px;
}
td.vcell:hover > .copy-to-clipboard {
  display: inline-block;
}
td.vcell > p {
  display: inline-block;
  margin: 5px 1px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
td.vcell span.violation-mark {
  font-size: x-small;
  font-weight: bold;
  margin-right: 4px;
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

thead th.row,
thead th.ctrl,
tbody td.row,
tbody td.ctrl {
  position: sticky;
  left: 0;
  z-index: 1;
  background-color: var(--vscode-editorPane-background);
}

tbody td.row,
tbody td.ctrl {
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
p.rule-violation-legend {
  margin: 0 5px;
}
/* tr.inserted {
  background-color: var(--vscode-diffEditor-insertedTextBackground) !important;
}
tr.removed {
  background-color: var(--vscode-diffEditor-removedTextBackground) !important;
} */
</style>
