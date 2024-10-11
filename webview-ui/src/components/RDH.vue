<script setup lang="ts">
import type { CellFocusParams, ShowCellDetailParams, ShowRecordParams } from "@/types/RdhEvents";
import type {
  EditRowDeleteValues,
  EditRowInsertValues,
  EditRowUpdateValues,
  RdhViewConfig,
  SaveValuesInRdhParams,
} from "@/utilities/vscode";
import {
  type AnnotationType,
  type ChangeInNumbersAnnotation,
  type CodeResolvedAnnotation,
  type CompareKey,
  type FileAnnotation,
  type GeneralColumnType,
  type RdhKey,
  type RdhRow,
  type ResultSetData,
  type RuleAnnotation,
  isArray,
  isBinaryLike,
  isBooleanLike,
  isDateTimeOrDate,
  isDateTimeOrDateOrTime,
  isEnumOrSet,
  isJsonLike,
  isNumericLike,
  isTextLike,
  isUUIDType,
} from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import { computed, nextTick, ref } from "vue";
import FileAnnotationView from "./base/FileAnnotationView.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

type Props = {
  rdh: ResultSetData;
  config?: RdhViewConfig;
  width: number;
  height: number;
  withComment: boolean;
  withType?: boolean;
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
    [key: string]: CodeResolvedAnnotation["values"];
  };
  $changeInNumbers: {
    [key: string]: ChangeInNumbersAnnotation["values"];
  };
  $beforeKeyValues?: {
    [key: string]: any;
  };
  $beforeValues?: {
    [key: string]: any;
  };
  $fileValues: {
    [key: string]: FileAnnotation["values"];
  };
};

type ColKey = {
  name: string;
  gtype: GeneralColumnType;
  visibleDetailPane: boolean;
  type: string;
  typeClass: string;
  width: number;
  inputSize: number;
  comment: string;
  required?: boolean;
  align?: "left" | "center" | "right";
};

const selectedRowIndex = ref(-1);
const editable = props.rdh.meta?.editable === true;

const emit = defineEmits<{
  (event: "onClickCell", value: CellFocusParams): void;
  (event: "onShowDetailPane", value: ShowCellDetailParams): void;
  (event: "onShowRecordAtDetailPane", value: ShowRecordParams): void;
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
    const disabledDetailPane = ((k.meta ?? {}) as any)["disabledDetailPane"] === true;

    if (isNumericLike(k.type)) {
      typeClass = "codicon-symbol-numeric";
      type = "number";
      if (k.type === "year") {
        width = 55;
      }
    } else if (isUUIDType(k.type)) {
      width = 280;
    } else if (isDateTimeOrDateOrTime(k.type)) {
      typeClass = "codicon-calendar";
      width = 160;
      if (isDateTimeOrDate(k.type)) {
        if (k.type === "date") {
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
      gtype: k.type,
      visibleDetailPane: (isTextLike(k.type) || isJsonLike(k.type)) && !disabledDetailPane,
      type,
      typeClass,
      required: k.required,
      width,
      inputSize: Math.ceil(width / 8),
      comment: k.comment,
      align: k.align,
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
    .map((row): RowValues => {
      const item: RowValues = {
        $meta: row.meta,
        $resolvedLabels: {},
        $changeInNumbers: {},
        $ruleViolationMarks: {},
        $fileValues: {},
      };
      if (editable && compareKey) {
        item.$beforeKeyValues = {};
        compareKey.names.forEach((it) => {
          item.$beforeKeyValues![it] = row.values[it];
        });
        item.$beforeValues = {};
      }
      props.rdh.keys.map((k) => {
        const meta: RdhRow["meta"] = item["$meta"];
        item[k.name] = toValue(k, row.values[k.name]);
        if (item.$beforeValues) {
          item.$beforeValues[k.name] = item[k.name];
        }
        if (props.rdh.meta?.codeItems) {
          const meta = row.meta;
          const code = meta[k.name]?.find((it) => it.type === "Cod") as CodeResolvedAnnotation;
          item.$resolvedLabels[k.name] = code?.values;
        }
        if (ruleViolationSummary) {
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
        // change in numbers
        const cinAnnonation = meta[k.name]?.find(
          (it) => it.type === "Cin"
        ) as ChangeInNumbersAnnotation;
        if (cinAnnonation) {
          item.$changeInNumbers[k.name] = cinAnnonation.values;
        }

        // file
        const fileAnnonation = meta[k.name]?.find((it) => it.type === "Fil") as FileAnnotation;
        if (fileAnnonation) {
          item.$fileValues[k.name] = fileAnnonation.values;
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
    $changeInNumbers: {},
    $ruleViolationMarks: {},
    $fileValues: {},
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
  if (isBooleanLike(key.type)) {
    return value === true ? "T" : "F";
  }
  if (isDateTimeOrDate(key.type)) {
    if (key.type === "date") {
      if (props.config?.dateFormat === "YYYY-MM-DD HH:mm:ss") {
        return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
      }
      return dayjs(value).format("YYYY-MM-DD");
    } else {
      return dayjs(value).format("YYYY-MM-DD HH:mm:ss");
    }
  }
  if (isBinaryLike(key.type) && value) {
    if (value.type === "Buffer" && value.data && Array.isArray(value.data)) {
      if (props.config?.binaryToHex) {
        const arr = value.data as number[];
        const buffer = arr.map((it) => `${it <= 9 ? "0" : ""}${it.toString(16)}`).join("");
        return `B'${buffer.substring(0, 64)}`;
      }
    }
    return "(BINARY)";
  }

  return value;
}

const onClickCell = ({
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
  selectedRowIndex.value = rowPos;
  emit("onClickCell", params);
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
  const styles: { [key: string]: any } = {
    "width": `${keyInfo.width}px`,
    "max-width": `${keyInfo.width}px`,
  };
  const meta: RdhRow["meta"] = p["$meta"];
  if (
    keyInfo.align &&
    !hasAnnotationsOf(meta, "Cod", keyInfo.name) &&
    !hasAnnotationsOf(meta, "Cin", keyInfo.name)
  ) {
    styles["text-align"] = keyInfo.align;
  }
  if (hasAnnotationsOf(meta, "Upd", keyInfo.name)) {
    styles["background-color"] = "rgba(112, 83, 255, 0.32) !important";
  }
  if (hasAnnotationsOf(meta, "Rul", keyInfo.name)) {
    styles["background-color"] = "rgba(232, 232, 83, 0.21) !important";
  }
  return styles;
};

const rowStyle = (p: any, rowIndex: number): any => {
  const meta: RdhRow["meta"] = p["$meta"];
  if (hasAnnotationsOf(meta, "Add")) {
    return { "background-color": "rgba(195, 232, 141, 0.22) !important" };
  } else if (hasAnnotationsOf(meta, "Del")) {
    return { "background-color": "rgba(255, 83, 112, 0.25) !important" };
  } else if (hasAnnotationsOf(meta, "Upd")) {
    return { "background-color": "rgba(112, 83, 255, 0.17) !important" };
  } else if (hasAnnotationsOf(meta, "Rul")) {
    return { "background-color": "rgba(232, 232, 83, 0.09) !important" };
  }
  if (rowIndex === selectedRowIndex.value) {
    return { "background-color": "rgba(232, 232, 232, 0.09) !important" };
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

const showDetail = (item: RowValues, key: ColKey, value: any) => {
  const params: ShowCellDetailParams = {
    name: key.name,
    gtype: key.gtype,
    type: key.type,
    comment: key.comment,
    required: key.required,
    value,
  };
  emit("onShowDetailPane", params);
};

const showDetailAll = (item: RowValues) => {
  const o = JSON.parse(JSON.stringify(item));
  delete o.editType;
  delete o.$meta;
  delete o.$resolvedLabels;
  delete o.$changeInNumbers;
  delete o.$ruleViolationMarks;
  delete o.$fileValues;
  delete o.$changeInNumbers;
  delete o.$beforeKeyValues;
  delete o.$beforeValues;
  const params: ShowRecordParams = {
    value: o
  };
  emit("onShowRecordAtDetailPane", params);
};

const copyToClipboard = (text: string) => {
  navigator?.clipboard?.writeText(text);
};

const save = (): SaveValuesInRdhParams => {
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
      <VirtualList v-if="visible" :items="list" :table="true" class="list-table" :style="{ height: `${height}px` }">
        <template #prepend>
          <thead>
            <tr>
              <th v-if="editable" class="ctrl">CONTROL</th>
              <th class="row">ROW</th>
              <th v-for="(key, idx) of columns" :key="idx" :title="key.name" :style="{ width: `${key.width}px` }">
                <span class="codicon" :class="key.typeClass"></span><span class="label"
                  :style="{ 'width': `${key.width - 18}px`, 'max-width': `${key.width - 18}px` }">{{ key.name }}</span>
                <a class="widen" @click="key.width += 100"><span class="codicon codicon-arrow-both"></span></a>
              </th>
            </tr>
            <tr v-if="withComment || editable">
              <th v-if="editable" class="ctrl">
                <div style="display: flex !important">
                  <VsCodeButton v-if="editable" @click="addRow" title="Add row" appearance="secondary">
                    <fa icon="plus" />Add
                  </VsCodeButton>
                </div>
              </th>
              <th class="row"></th>
              <th v-for="(key, idx) of columns" :key="idx"
                :style="{ 'width': `${key.width}px`, 'max-width': `${key.width}px` }" :title="key.comment">
                {{ key.comment }}
              </th>
            </tr>
            <tr v-if="withType || editable">
              <th v-if="editable" class="ctrl">
                <div style="display: flex !important"></div>
              </th>
              <th class="row">[TYPE]</th>
              <th v-for="(key, idx) of columns" :key="idx"
                :style="{ 'width': `${key.width}px`, 'max-width': `${key.width}px` }" :title="key.gtype">
                {{ key.gtype }}
              </th>
            </tr>
          </thead>
        </template>
        <template #default="{ item, index }">
          <tr :style="rowStyle(item, index)" :class="{ selectedRow: index === selectedRowIndex }">
            <td v-if="editable" class="ctrl">
              <div>
                <VsCodeButton v-if="editable" :disabled="item.editType === 'ins'" @click="editRow(index)"
                  title="Update row" appearance="secondary">
                  <fa icon="pencil" />
                </VsCodeButton>
                <VsCodeButton v-if="editable" @click="deleteRow(index)" title="Delete row" appearance="secondary">
                  <fa icon="trash" />
                </VsCodeButton>
              </div>
            </td>
            <td class="row" @click="onClickCell({ rowPos: index, colPos: -1, key: '', rowValues: item })">
              {{ toEditTypeMark(item.editType) }}
              {{ index + 1 }}
              <div class="cell-actions" v-if="!editable">
                <VsCodeButton @click.stop="showDetailAll(item)" appearance="secondary" class="show-detail">
                  <fa icon="eye" size="sm" />
                </VsCodeButton>
              </div>
            </td>
            <td class="vcell" v-for="(key, idx) of columns" :key="idx" :style="cellStyle(item, key)"
              @click="onClickCell({ rowPos: index, colPos: idx, key: key.name, rowValues: item })">
              <VsCodeTextField v-if="item.editType === 'ins' || item.editType === 'upd'" v-model="item[key.name]"
                :readonly="false" :required="key.required" :transparent="true" :maxlength="1000" :size="key.inputSize"
                style="width: 99%"></VsCodeTextField>
              <template v-else>
                <template v-if="item.$fileValues[key.name]">
                  <FileAnnotationView :text="item[key.name]" :annotation="item.$fileValues[key.name]" />
                </template>
                <template v-else>
                  <p :class="{
                    'code-value': item.$resolvedLabels[key.name],
                    'is-null': item[key.name] == null,
                  }" :title="item[key.name]">
                    <span v-if="item.$ruleViolationMarks[key.name]" class="violation-mark">{{
                      item.$ruleViolationMarks[key.name]
                      }}</span>
                    <span class="val">{{ item[key.name] }}</span>
                  </p>
                  <span v-if="item.$resolvedLabels[key.name]" class="marker-box code-label" :class="{
                    'marker-info': item.$resolvedLabels[key.name]?.isUndefined === false,
                    'marker-error': item.$resolvedLabels[key.name]?.isUndefined,
                  }">{{ item.$resolvedLabels[key.name]?.label }}</span>
                  <span v-if="item.$changeInNumbers[key.name]" class="marker-box code-label" :class="{
                    'marker-info': item.$changeInNumbers[key.name]?.value >= 0,
                    'marker-error': item.$changeInNumbers[key.name]?.value < 0,
                  }">{{ item.$changeInNumbers[key.name]?.value >= 0 ? " +" : " " }}
                    {{ item.$changeInNumbers[key.name]?.value }}</span>
                  <div class="cell-actions" v-if="
                    item[key.name] !== undefined &&
                    item[key.name] !== null &&
                    item[key.name] !== ''
                  ">
                    <VsCodeButton v-if="key.visibleDetailPane" @click.stop="showDetail(item, key, item[key.name])"
                      appearance="secondary" class="show-detail">
                      <fa icon="eye" />
                    </VsCodeButton>
                    <VsCodeButton @click.stop="copyToClipboard(item[key.name])" appearance="secondary"
                      class="copy-to-clipboard">
                      <fa icon="clipboard" />
                    </VsCodeButton>
                  </div>
                </template>
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

<style lang="scss" scoped>
thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: var(--vscode-editorPane-background);
}

tr {
  &.selectedRow {

    td.ctrl,
    td.row {
      background-color: var(--vscode-editorGroupHeader-tabsBackground);
    }
  }
}

td,
th {
  border-right: calc(var(--border-width) * 1px) groove var(--dropdown-border);
  border-bottom: calc(var(--border-width) * 1px) groove var(--dropdown-border);

  &.row {
    min-width: 55px;
    width: 55px;
    max-width: 55px;
    position: sticky;
    left: 0;
    z-index: 1;
    background-color: var(--vscode-editorPane-background);
  }

  &.ctrl {
    min-width: 80px;
    width: 80px;
    max-width: 80px;
    position: sticky;
    left: 0;
    z-index: 1;
    background-color: var(--vscode-editorPane-background);

    &>div {
      display: none;

      &>vscode-button {
        flex: 1;
      }
    }

    &:hover>div {
      display: flex;
      flex-direction: row;
      column-gap: 3px;
    }
  }
}

td {
  text-align: center;

  &.row,
  &.ctrl {
    text-align: right;
    padding-right: 5px;
  }

  &.row {
    position: relative;

    &>.cell-actions {
      display: none;
      position: absolute;
      right: 2px;
      top: 4px;
    }

    &:hover>.cell-actions {
      display: inline-block;
    }
  }

  &.vcell {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    position: relative;
    padding-right: 2px;

    &>a.download-link {
      display: inline-block;
      position: absolute;
      left: 4px;
      top: 4px;
      border-radius: 3px;
      padding: 1px;
    }

    &>.code-label {
      display: inline-block;
      position: absolute;
      right: 4px;
      top: 4px;
      border-radius: 3px;
      padding: 1px;
    }

    &:hover>.code-label {
      display: none;
    }

    &>.cell-actions {
      display: none;
      position: absolute;
      right: 1px;
      top: 2px;
    }

    &:hover>.cell-actions {
      display: inline-block;
    }

    &>p {
      display: inline-block;
      margin: 5px 0px 5px 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      width: 100%;

      &>span.val {
        margin-right: 2px;
      }

      &.is-null::after {
        position: absolute;
        content: "(NULL)";
        color: gray;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }
    }

    span.violation-mark {
      font-size: x-small;
      font-weight: bold;
      margin-right: 4px;
    }
  }
}

th {
  height: 20px;
  padding: 2px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  position: relative;

  &>a.widen {
    cursor: pointer;
    display: none;
    position: absolute;
    right: 2px;
    top: 2px;
  }

  &:hover>a.widen {
    display: inline-block;
  }
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

p.code-value {
  text-align: left;
}

/* tr.inserted {
  background-color: var(--vscode-diffEditor-insertedTextBackground) !important;
}
tr.removed {
  background-color: var(--vscode-diffEditor-removedTextBackground) !important;
} */
</style>
