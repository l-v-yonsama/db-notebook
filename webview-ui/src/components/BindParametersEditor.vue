<script setup lang="ts">
import type { BindParameterRow } from "@/utilities/vscode";
import {
  addBindParameterRow,
  deleteBindParameterRow,
  updateBindParameterRowValue,
} from "@/utilities/bindParameterRows";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

// The parent owns complete rows; pure helpers perform add, delete, and
// renumber operations outside this component.
type Props = {
  modelValue: BindParameterRow[];
  dbType: string;
  disabled?: boolean;
};
const props = defineProps<Props>();

const emit = defineEmits<{
  (event: "update:modelValue", rows: BindParameterRow[]): void;
}>();

const onAdd = (): void => {
  emit("update:modelValue", addBindParameterRow(props.modelValue, props.dbType));
};

const onDelete = (id: string): void => {
  emit("update:modelValue", deleteBindParameterRow(props.modelValue, id));
};

const onValueChange = (id: string, value: string): void => {
  emit("update:modelValue", updateBindParameterRowValue(props.modelValue, id, value));
};

const rowPosition = (row: BindParameterRow): string =>
  row.location ? `${row.location.line},${row.location.column}` : "-";
</script>

<template>
  <section class="bind-parameters">
    <fieldset>
      <legend>
        <span class="title">Bind Parameters</span>
        <VsCodeButton @click="onAdd" appearance="secondary" :disabled="disabled" title="Add parameter"
          style="margin-left: 2px">
          <fa icon="plus" />Add parameter
        </VsCodeButton>
      </legend>
      <p class="hint">Parameters are estimated. Add or remove rows if necessary.</p>
      <table>
        <thead>
          <tr>
            <th class="no">No</th>
            <th class="placeholder">Placeholder</th>
            <th class="rowcol">Row,Col</th>
            <th class="col">Estimated column</th>
            <th class="type">Estimated type</th>
            <th class="val">Value</th>
            <th class="ctl">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row of modelValue" :key="row.id">
            <td class="no">{{ row.position }}</td>
            <td class="placeholder">{{ row.marker }}</td>
            <td class="rowcol">{{ rowPosition(row) }}</td>
            <td class="col">{{ row.estimatedColumn ?? "-" }}</td>
            <td class="type">{{ row.estimatedType }}</td>
            <td class="val">
              <VsCodeTextField :model-value="row.value" :disabled="disabled" :transparent="true" style="width: 100%"
                @update:model-value="(v) => onValueChange(row.id, String(v))" />
            </td>
            <td class="ctl">
              <VsCodeButton appearance="secondary" class="deleteKey" :disabled="disabled" title="Delete"
                @click="onDelete(row.id)">
                <span class="codicon codicon-trash"></span>Del
              </VsCodeButton>
            </td>
          </tr>
        </tbody>
      </table>
    </fieldset>
  </section>
</template>

<style lang="scss" scoped>
section.bind-parameters {
  margin-top: 4px;

  fieldset {
    legend {
      width: -webkit-fill-available;
      display: flex;
      align-items: center;

      .title {
        font-weight: 600;
      }
    }

    .hint {
      margin: 2px 0 4px;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }

    table {
      width: 100%;

      .no {
        width: 45px;
        max-width: 45px;
      }
      .placeholder {
        width: 90px;
        max-width: 90px;
      }
      .rowcol {
        width: 70px;
        max-width: 70px;
        text-align: center;
      }
      .col {
        width: 220px;
      }
      .type {
        width: 110px;
      }
      .ctl {
        width: 60px;
        max-width: 60px;
      }
    }
  }
}
</style>
