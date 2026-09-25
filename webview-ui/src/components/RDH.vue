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
import { computed, nextTick, onBeforeUnmount, ref, toDisplayString } from "vue";
import CopyToClipboardButton from "./base/CopyToClipboardButton.vue";
import FileAnnotationView from "./base/FileAnnotationView.vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

type Props = {
  rdh: ResultSetData;
  config: RdhViewConfig | null;
  width: number;
  height: number;
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

const selectedRow = ref<RowValues | null>(null);
const editable = props.rdh.meta?.editable === true;
const hasComment = props.rdh.keys.some((it) => it.comment?.length);
const withComment = props.config?.displayComment;
const withType = props.config?.displayType;
const showCommentRow = (hasComment && withComment) || editable;
const showTypeRow = withType;
const showRowColumn = props.config?.hideRowColumn === undefined ? true : !props.config.hideRowColumn;

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

const minColumnWidth = 50;
const fixedColumnLayout = ref<{ prefixWidths: number[]; tableWidth: number } | null>(null);
let resizingColumn: {
  key: ColKey;
  pointerId: number;
  startX: number;
  startWidth: number;
} | null = null;

const setColumnWidth = (key: ColKey, width: number): void => {
  const nextWidth = Math.max(minColumnWidth, Math.round(width));
  if (fixedColumnLayout.value) {
    fixedColumnLayout.value.tableWidth += nextWidth - key.width;
  }
  key.width = nextWidth;
  key.inputSize = Math.ceil(key.width / 8);
};

const freezeColumnLayout = (target: HTMLElement): boolean => {
  const headers = target.closest("table")?.querySelectorAll("thead tr:first-child th");
  const prefixCount = Number(editable) + Number(showRowColumn);
  if (!headers || headers.length !== columns.value.length + prefixCount) {
    return false;
  }
  // Auto table layout distributes spare space. Freeze the rendered widths so the
  // boundary follows the pointer instead of redistributing the other columns.
  const widths = Array.from(headers, (cell) => Math.round(cell.getBoundingClientRect().width));
  columns.value.forEach((column, index) => {
    column.width = widths[index + prefixCount];
    column.inputSize = Math.ceil(column.width / 8);
  });
  fixedColumnLayout.value = {
    prefixWidths: widths.slice(0, prefixCount),
    tableWidth: widths.reduce((sum, width) => sum + width, 0),
  };
  return true;
};

const startColumnResize = (event: PointerEvent, key: ColKey): void => {
  if (resizingColumn || !event.isPrimary || event.button !== 0) {
    return;
  }
  const handle = event.currentTarget as HTMLElement;
  if (!freezeColumnLayout(handle)) {
    return;
  }
  resizingColumn = {
    key,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: key.width,
  };
  handle.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
};

const moveColumnResize = (event: PointerEvent): void => {
  if (resizingColumn?.pointerId !== event.pointerId) {
    return;
  }
  setColumnWidth(resizingColumn.key, resizingColumn.startWidth + event.clientX - resizingColumn.startX);
  event.preventDefault();
};

const endColumnResize = (event: PointerEvent): void => {
  if (resizingColumn?.pointerId !== event.pointerId) {
    return;
  }
  resizingColumn = null;
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId);
  }
};

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

const columnFilters = ref<Record<string, string>>({});
const cellText = (value: unknown): string => toDisplayString(value);
const activeFilters = computed(() =>
  Object.entries(columnFilters.value)
    .filter(([, term]) => term.length > 0)
    .map(([name, term]) => [name, term.toLowerCase()] as const)
);
const filteredList = computed(() => {
  if (activeFilters.value.length === 0) {
    return list.value;
  }
  // Keep unsaved editors visible while their values are being changed.
  return list.value.filter((row) =>
    row.editType === "ins" || row.editType === "upd" ||
    activeFilters.value.every(([name, term]) => cellText(row[name]).toLowerCase().includes(term))
  );
});
const sourceIndexes = computed(() => new Map(list.value.map((row, index) => [row, index])));
const sourceIndex = (row: RowValues): number => sourceIndexes.value.get(row) ?? -1;

const highlightedParts = (value: unknown, name: string): { text: string; match: boolean }[] => {
  const content = cellText(value);
  const term = columnFilters.value[name]?.toLowerCase();
  if (!term) {
    return [{ text: content, match: false }];
  }
  const lowerContent = content.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  let matchAt = lowerContent.indexOf(term);
  while (matchAt >= 0) {
    if (matchAt > from) {
      parts.push({ text: content.slice(from, matchAt), match: false });
    }
    parts.push({ text: content.slice(matchAt, matchAt + term.length), match: true });
    from = matchAt + term.length;
    matchAt = lowerContent.indexOf(term, from);
  }
  if (from < content.length) {
    parts.push({ text: content.slice(from), match: false });
  }
  return parts;
};

const filterPopup = ref<{ name: string; top: number; left: number } | null>(null);
const filterPopupElement = ref<HTMLElement | null>(null);
const filterInput = ref<HTMLInputElement | null>(null);
const draftFilter = ref("");
let filterTrigger: HTMLElement | null = null;

const closeFilterPopup = (): void => {
  filterPopup.value = null;
  filterTrigger = null;
  window.removeEventListener("pointerdown", onFilterPointerDown, true);
  window.removeEventListener("scroll", closeFilterPopup, true);
  window.removeEventListener("resize", closeFilterPopup);
};

function onFilterPointerDown(event: PointerEvent): void {
  const target = event.target as Node;
  if (!filterPopupElement.value?.contains(target) && !filterTrigger?.contains(target)) {
    closeFilterPopup();
  }
}

const openFilterPopup = (event: MouseEvent, name: string): void => {
  const trigger = event.currentTarget as HTMLElement;
  if (filterPopup.value?.name === name) {
    closeFilterPopup();
    return;
  }
  closeFilterPopup();
  const rect = trigger.getBoundingClientRect();
  const popupWidth = Math.min(260, Math.max(0, window.innerWidth - 16));
  const popupHeight = 150;
  filterPopup.value = {
    name,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8)),
    top: rect.bottom + popupHeight <= window.innerHeight
      ? rect.bottom + 4
      : Math.max(8, rect.top - popupHeight - 4),
  };
  draftFilter.value = columnFilters.value[name] ?? "";
  filterTrigger = trigger;
  window.addEventListener("pointerdown", onFilterPointerDown, true);
  window.addEventListener("scroll", closeFilterPopup, true);
  window.addEventListener("resize", closeFilterPopup);
  nextTick(() => filterInput.value?.focus());
};

const applyFilter = (): void => {
  if (!filterPopup.value) {
    return;
  }
  const next = { ...columnFilters.value };
  const term = draftFilter.value.trim();
  if (term) {
    next[filterPopup.value.name] = term;
  } else {
    delete next[filterPopup.value.name];
  }
  columnFilters.value = next;
  closeFilterPopup();
};

const clearFilter = (): void => {
  draftFilter.value = "";
  applyFilter();
};

onBeforeUnmount(closeFilterPopup);

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
      if (props.config?.dateFormat) {
        return dayjs(value).format(props.config?.dateFormat);
      }
      return dayjs(value).format("YYYY-MM-DD");
    } else {
      if (props.config?.timestampFormat) {
        return dayjs(value).format(props.config?.timestampFormat);
      }
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
  if (isEnumOrSet(key.type) || isArray(key.type)) {
    return value.toString();
  }
  if (isJsonLike(key.type)) {
    return JSON.stringify(value);
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
  selectedRow.value = rowValues;
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
  if (hasAnnotationsOf(meta, "Err", keyInfo.name)) {
    styles["background-color"] = "rgba(200, 33, 33, 0.32) !important";
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
    // } else if (hasAnnotationsOf(meta, "Rul")) {
    // return { "background-color": "rgba(232, 232, 83, 0.09) !important" };
  }
  if (p === selectedRow.value) {
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
      <VirtualList v-if="visible" :items="filteredList" :table="true" class="list-table"
        :class="{ 'fixed-columns': fixedColumnLayout !== null }"
        :style="{ height: `${height}px`, '--rdh-table-width': fixedColumnLayout ? `${fixedColumnLayout.tableWidth}px` : undefined }">
        <template #prepend>
          <colgroup v-if="fixedColumnLayout">
            <col v-for="(columnWidth, idx) of fixedColumnLayout.prefixWidths" :key="`prefix-${idx}`"
              :style="{ width: `${columnWidth}px` }" />
            <col v-for="(key, idx) of columns" :key="idx" :style="{ width: `${key.width}px` }" />
          </colgroup>
          <thead>
            <tr>
              <th v-if="editable" class="ctrl">CONTROL</th>
              <th v-if="showRowColumn" class="row">ROW</th>
              <th v-for="(key, idx) of columns" :key="idx" :title="key.name"
                :class="{ 'has-filter': !!columnFilters[key.name] }" :style="{ width: `${key.width}px` }">
                <div class="column-heading">
                  <span class="codicon" :class="key.typeClass"></span><span class="label">{{ key.name }}</span>
                  <button type="button" class="column-filter-button" :class="{ active: !!columnFilters[key.name] }"
                    :title="columnFilters[key.name] ? `Filter ${key.name}: ${columnFilters[key.name]}` : `Filter ${key.name}`"
                    :aria-label="columnFilters[key.name] ? `Filter ${key.name}, active: ${columnFilters[key.name]}` : `Filter ${key.name}`"
                    aria-haspopup="dialog" :aria-expanded="filterPopup?.name === key.name"
                    @click.stop="openFilterPopup($event, key.name)">
                    <span class="codicon codicon-filter"></span>
                  </button>
                </div>
                <span class="column-resize-handle" aria-hidden="true" @pointerdown="startColumnResize($event, key)"
                  @pointermove="moveColumnResize" @pointerup="endColumnResize" @pointercancel="endColumnResize"
                  @lostpointercapture="endColumnResize" @click.stop></span>
              </th>
            </tr>
            <tr v-if="showCommentRow">
              <th v-if="editable" class="ctrl">
                <div style="display: flex !important">
                  <VsCodeButton v-if="editable" @click="addRow" title="Add row" appearance="secondary">
                    <fa icon="plus" />Add
                  </VsCodeButton>
                </div>
              </th>
              <th v-if="showRowColumn" class="row"></th>
              <th v-for="(key, idx) of columns" :key="idx"
                :style="{ 'width': `${key.width}px`, 'max-width': `${key.width}px` }" :title="key.comment">
                {{ key.comment }}
              </th>
            </tr>
            <tr v-if="showTypeRow">
              <th v-if="editable" class="ctrl">
                <div style="display: flex !important"></div>
              </th>
              <th v-if="showRowColumn" class="row">TYPE</th>
              <th v-for="(key, idx) of columns" :key="idx"
                :style="{ 'width': `${key.width}px`, 'max-width': `${key.width}px` }" :title="key.gtype">
                {{ key.gtype }}
              </th>
            </tr>
          </thead>
        </template>
        <template #default="{ item, index }">
          <tr :style="rowStyle(item, index)" :class="{ selectedRow: item === selectedRow }">
            <td v-if="editable" class="ctrl">
              <div>
                <VsCodeButton v-if="editable" :disabled="item.editType === 'ins'" @click="editRow(sourceIndex(item))"
                  title="Update row" appearance="secondary">
                  <fa icon="pencil" />
                </VsCodeButton>
                <VsCodeButton v-if="editable" @click="deleteRow(sourceIndex(item))" title="Delete row" appearance="secondary">
                  <fa icon="trash" />
                </VsCodeButton>
              </div>
            </td>
            <td v-if="showRowColumn" class="row" @click="onClickCell({ rowPos: sourceIndex(item), colPos: -1, key: '', rowValues: item })">
              {{ toEditTypeMark(item.editType) }}
              {{ sourceIndex(item) + 1 }}
              <div class="cell-actions" v-if="!editable">
                <VsCodeButton @click.stop="showDetailAll(item)" appearance="secondary" class="show-detail"
                  title="View details">
                  <fa icon="eye" size="sm" />
                </VsCodeButton>
              </div>
            </td>
            <td class="vcell" v-for="(key, idx) of columns" :key="idx" :style="cellStyle(item, key)"
              @click="onClickCell({ rowPos: sourceIndex(item), colPos: idx, key: key.name, rowValues: item })">
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
                    <span class="val">
                      <template v-if="columnFilters[key.name]">
                        <template v-for="(part, partIndex) of highlightedParts(item[key.name], key.name)" :key="partIndex">
                          <mark v-if="part.match" class="filter-match">{{ part.text }}</mark>
                          <template v-else>{{ part.text }}</template>
                        </template>
                      </template>
                      <template v-else>{{ item[key.name] }}</template>
                    </span>
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
                      appearance="secondary" class="show-detail" title="View details">
                      <fa icon="eye" />
                    </VsCodeButton>
                    <CopyToClipboardButton :content="item[key.name]" appearance="secondary" title="Copy to clipboard" />
                  </div>
                </template>
              </template>
            </td>
          </tr>
        </template>
      </VirtualList>
    </section>
    <Teleport to="body">
      <div v-if="filterPopup" ref="filterPopupElement" class="rdh-filter-popup" role="dialog"
        :aria-label="`Filter ${filterPopup.name}`" :style="{ top: `${filterPopup.top}px`, left: `${filterPopup.left}px` }"
        @keydown.esc.stop.prevent="closeFilterPopup">
        <form @submit.prevent="applyFilter">
          <label>Filter {{ filterPopup.name }}
            <input ref="filterInput" v-model="draftFilter" type="text" placeholder="Contains text" />
          </label>
          <div class="filter-actions">
            <button type="button" @click="clearFilter">Clear</button>
            <button type="button" @click="closeFilterPopup">Cancel</button>
            <button type="submit" class="apply-filter">Apply</button>
          </div>
        </form>
      </div>
    </Teleport>
    <p v-if="legend.length" class="rule-violation-legend" v-text="legend"></p>
  </section>
</template>

<style>
.list-table table {
  border-collapse: collapse;
  width: 100%;
}

.list-table.fixed-columns table {
  table-layout: fixed;
  width: var(--rdh-table-width);
}
</style>

<style lang="scss" scoped>
/* =========================
   Sticky header
========================= */

thead {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--vscode-editorPane-background);
}

/* =========================
   Base table cell
========================= */

td,
th {
  border-right: calc(var(--border-width) * 1px) groove var(--dropdown-border);
  border-bottom: calc(var(--border-width) * 1px) groove var(--dropdown-border);
}

/* =========================
   Column types
========================= */

/* CONTROL COLUMN */

th.ctrl,
td.ctrl {

  width: 80px;
  min-width: 80px;
  max-width: 80px;

  position: sticky;
  left: 0;
  z-index: 3;

  background: var(--vscode-editorPane-background);
  text-align: right;
  padding-right: 5px;

  >div {
    display: none;

    >vscode-button {
      flex: 1;
    }
  }

  &:hover>div {
    display: flex;
    column-gap: 3px;
  }
}

/* ROW NUMBER COLUMN */

th.row,
td.row {

  width: 55px;
  min-width: 55px;
  max-width: 55px;

  position: sticky;
  left: 0;
  z-index: 2;

  background: var(--vscode-editorPane-background);
  text-align: right;
  padding-right: 5px;

  .cell-actions {
    display: none;
    position: absolute;
    right: 2px;
    top: 4px;
  }

  &:hover .cell-actions {
    display: inline-block;
  }
}

/* DATA COLUMN */

td.vcell {

  position: relative;
  padding-right: 2px;

  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;

  >a.download-link {
    position: absolute;
    left: 4px;
    top: 4px;
  }

  >.code-label {
    position: absolute;
    right: 4px;
    top: 4px;
  }

  &:hover>.code-label {
    display: none;
  }

  .cell-actions {
    display: none;
    position: absolute;
    right: 1px;
    top: 2px;
  }

  &:hover .cell-actions {
    display: inline-block;
  }

  >p {
    margin: 5px 0 5px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  span.violation-mark {
    font-size: x-small;
    font-weight: bold;
    margin-right: 4px;
  }
}

/* =========================
   Row states
========================= */

tr.selectedRow td.ctrl,
tr.selectedRow td.row {
  background: var(--vscode-editorGroupHeader-tabsBackground);
}

/* =========================
   Header cells
========================= */

th {

  height: 20px;
  padding: 2px;
  position: relative;

  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;

  &:hover > .column-heading,
  &.has-filter > .column-heading {
    padding-right: 28px;
  }

  &:hover > .column-heading > .column-filter-button,
  &.has-filter > .column-heading > .column-filter-button {
    visibility: visible;
  }

  >.column-heading {
    display: flex;
    align-items: center;
    padding-right: 8px;

    >.codicon {
      flex: none;
    }

    >.column-filter-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: absolute;
      top: 50%;
      right: 8px;
      transform: translateY(-50%);
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: 2px;
      color: var(--vscode-foreground);
      background: transparent;
      cursor: pointer;
      visibility: hidden;

      >.codicon {
        margin-right: 0;
      }

      &:hover,
      &.active {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
      }

      &:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
      }
    }
  }

  >.column-resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: col-resize;
    touch-action: none;
    z-index: 1;

    &:hover {
      background: var(--vscode-focusBorder);
    }
  }
}

/* =========================
   Icons / misc
========================= */

span.codicon {
  margin-right: 2px;
  vertical-align: middle;
}

span.label {
  display: block;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

mark.filter-match {
  color: inherit;
  background: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 190, 0, 0.45));
  border-radius: 2px;
}

.rdh-filter-popup {
  position: fixed;
  z-index: 1000;
  box-sizing: border-box;
  width: min(260px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-focusBorder));
  border-radius: 4px;
  color: var(--vscode-foreground);
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);

  label {
    display: block;
    margin-bottom: 6px;
  }

  input {
    box-sizing: border-box;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--vscode-input-border, var(--vscode-focusBorder));
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    background: var(--vscode-input-background, var(--vscode-editor-background));
    font: inherit;
  }

  .filter-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 10px;

    button {
      padding: 4px 8px;
      border: 0;
      border-radius: 2px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, var(--vscode-toolbar-hoverBackground));
      cursor: pointer;
    }

    .apply-filter {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
  }
}

p.rule-violation-legend {
  margin: 0 5px;
}

p.code-value {
  text-align: left;
}
</style>
