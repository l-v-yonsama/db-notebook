<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  DBDumpInputParams,
  DBDumpOptionParams,
  DBDumpSettingsPanelEventData,
  LabelValueItem,
  OutputCompressionType
} from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { toNum } from "@l-v-yonsama/rdh";
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

const sectionHeight = ref(300);

type SelectableItem = LabelValueItem & {
  selected: boolean;
};

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper.clientHeight - 76, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const groupLabels: Record<string, string> = {
  content: "Content",
  filter: "Filter",
  performance: "Performance",
  compat: "Compatibility",
  advanced: "Advanced (Danger)",
};

const initialized = ref(false);

const disabledReasonMessage = computed<string | null>(() => {
  if (!initialized.value) return "Initializing...";

  if (outputTarget.value === "file" && !fileNamePrefix.value.trim()) {
    return "Output file name prefix is required";
  }

  if (targetScope.value === "schemas" && schemaItems.value.every(it => !it.selected)) {
    return "Select at least one schema";
  }

  if (targetScope.value === "tables" && tableItems.value.every(it => !it.selected)) {
    return "Select at least one table";
  }

  if (executeDumpInDockerContainer.value && !dockerContainerName.value) {
    return "Docker container is not selected";
  }

  return null;
});

const optionGroups = computed(() => {
  const map: Record<string, DBDumpOptionParams[]> = {};
  for (const opt of dumpOptions.value) {
    (map[opt.group] ??= []).push(opt);
  }
  return map;
});

const dbType = ref("MySQL" as DBDumpInputParams["dbType"]);
const executeDumpInDockerContainer = ref(false);
const userName = ref("");
const password = ref("");
const host = ref("");
const port = ref<number | undefined>(undefined);
const fileNamePrefix = ref("");
const previewCommand = ref("");
const selectableSchema = ref(false);

const targetScope = ref<"database" | "schemas" | "tables">("database");
const targetScopeItems: DropdownItem[] = [];

const dockerContainerName = ref("");
const dockerContainerItems: DropdownItem[] = [];

const outputTarget = ref<"stdout" | "file">("file");
const outputCompression = ref<OutputCompressionType>("none");

const outputTargetItems: DropdownItem[] = [
  { label: "Standard output", value: "stdout" },
  { label: "File", value: "file" },
];

const outputCompressionItems: DropdownItem[] = [
  { label: "None (plain SQL file)", value: "none" },
  { label: "gzip (.gz)", value: "gzip" },
  { label: "zstd (.zst)", value: "zstd" },
];

const schemaItems = ref<SelectableItem[]>([]);
const tableItems = ref<SelectableItem[]>([]);
const dumpOptions = ref<DBDumpOptionParams[]>([]);

const initialize = async (
  v: DBDumpSettingsPanelEventData["value"]["initialize"]
) => {
  initialized.value = false;
  await nextTick();
  if (!v) {
    initialized.value = true;
    return;
  }

  dbType.value = v.params.dbType;
  selectableSchema.value = v.params.dbType === "Postgres";

  outputTarget.value = v.params.outputTarget ?? "file";
  outputCompression.value = v.params.outputCompression ?? "none";
  fileNamePrefix.value = v.params.outputFilePrefix ?? "";

  targetScopeItems.splice(0);
  targetScopeItems.push({ label: "Database", value: "database" });
  if (selectableSchema.value) {
    targetScopeItems.push({ label: "Schema", value: "schemas" });
  }
  targetScopeItems.push({ label: "Table", value: "tables" });

  targetScope.value = v.params.targetScope;

  executeDumpInDockerContainer.value = v.params.executeDumpInDockerContainer;
  dockerContainerItems.splice(0, dockerContainerItems.length, { label: "", value: "" });
  v.uiParams.dockerContainerItems.forEach(it => dockerContainerItems.push(it));
  dockerContainerName.value = v.params.dockerContainerName;

  userName.value = v.params.userName;
  password.value = v.params.password;
  host.value = v.params.host ?? '';
  port.value = v.params.port;
  dumpOptions.value = v.params.options;
  previewCommand.value = v.uiParams.previewCommand;

  schemaItems.value = v.uiParams.schemas.map(it => ({
    ...it,
    selected: v.params.selectedSchemas.includes(it.value),
  }));

  tableItems.value = v.uiParams.tables.map(it => ({
    ...it,
    selected: v.params.selectedTables.includes(it.value),
  }));

  initialized.value = true;

  await nextTick();
  const wrapper = document.querySelector("section.top-scroll-wrapper");
  if (wrapper) wrapper.scrollTop = v.uiParams.scrollPos ?? 0;
};


const handleChange = () => {
  const lastKnownScrollPosition = document.querySelector(".top-scroll-wrapper")?.scrollTop ?? 0;

  const params: Partial<DBDumpInputParams> = {
    outputTarget: outputTarget.value,
    outputFilePrefix: fileNamePrefix.value,
    outputCompression: outputCompression.value,
    userName: userName.value,
    password: password.value,
    host: host.value,
    port: toNum(port.value),
    targetScope: targetScope.value,
    executeDumpInDockerContainer: executeDumpInDockerContainer.value,
    dockerContainerName: dockerContainerName.value,
    selectedSchemas: schemaItems.value.filter(it => it.selected).map(it => it.value),
    selectedTables: tableItems.value.filter(it => it.selected).map(it => it.value),
    options: JSON.parse(JSON.stringify(dumpOptions.value)),
  };
  vscode.postCommand({
    command: "inputChange",
    params: {
      ...params,
      scrollPos: lastKnownScrollPosition,
    },
  });
};

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const ok = () => {
  vscode.postCommand({
    command: "ok",
    params: {},
  });
};

const writeToClipboard = () => {
  vscode.postCommand({
    command: "writeToClipboard",
    params: {
      tabId: '',
      fileType: 'text'
    },
  });
};

const recieveMessage = (data: DBDumpSettingsPanelEventData) => {
  const { command, value } = data;
  switch (command) {
    case "initialize":
      if (value.initialize === undefined) {
        return;
      }
      initialize(value.initialize);
      break;
  }
};

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <div class="toolbar">
      <div class="tool-left">
        <div v-if="disabledReasonMessage" class="disabled-reason">
          ⚠ {{ disabledReasonMessage }}
        </div>
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton @click="writeToClipboard" appearance="secondary" title="Write to clipboard"
          :disabled="!!disabledReasonMessage">
          <fa icon="clipboard" />Copy to clipboard
        </VsCodeButton>
        <VsCodeButton @click="ok" title="Run Dump command" :disabled="!!disabledReasonMessage">
          <fa icon="check" />Run Dump
        </VsCodeButton>
      </div>
    </div>
    <section v-if="!initialized" class="centered-content">Just a moment, please.</section>
    <section v-else class="content top-scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="params content-child">
        <fieldset class="conditions">
          <legend>
            <span style="margin-right: 30px">Options</span>
          </legend>
          <div>
            <fieldset class="conditions" v-if="dbType !== 'SQLite'">
              <legend>
                <span style="margin-right: 30px">Base</span>
              </legend>
              <div>
                <label>
                  <input type="checkbox" v-model="executeDumpInDockerContainer" @change="($e: any) => handleChange()" />
                  Execute dump command inside the Docker container
                </label>
                <br>
                <small>When enabled, the database dump command will be executed inside the running Docker container
                  instead of the host machine.</small>
              </div>
              <div v-if="executeDumpInDockerContainer">
                <label for="dockerContainerName"> Container name:</label>
                <VsCodeDropdown id="dockerContainerName" v-model="dockerContainerName" :items="dockerContainerItems"
                  style="width: 320px;" :required="true" @change="handleChange()" />
              </div>
              <div>
                <label for="targetScope">Target scope:</label>
                <VsCodeRadioGroupVue id="targetScope" v-model="targetScope" :items="targetScopeItems"
                  @change="($e: any) => handleChange()" style="display: inline-block; margin-left: 20px;" />
              </div>
              <div>
                <label for="userName">User name:</label>
                <VsCodeTextField id="userName" v-model="userName" :maxlength="128" :transparent="true"
                  :change-on-mouseout="true" title="Output file name prefix" @change="($e: any) => handleChange()">
                </VsCodeTextField>
              </div>
              <div>
                <label for="password">Password:</label>
                <VsCodeTextField id="password" v-model="password" :maxlength="128" :transparent="true"
                  :change-on-mouseout="true" title="Output file name prefix" @change="($e: any) => handleChange()">
                </VsCodeTextField>
              </div>
              <div>
                <label for="host">Host:</label>
                <VsCodeTextField id="host" v-model="host" :transparent="true" :change-on-mouseout="true"
                  @change="handleChange()" />
              </div>
              <div>
                <label for="port">Port:</label>
                <VsCodeTextField id="port" type="number" v-model.number="port" :transparent="true"
                  :change-on-mouseout="true" @change="handleChange()" />
              </div>
            </fieldset>
            <fieldset class="conditions">
              <legend>
                <span style="margin-right: 30px">Output</span>
              </legend>
              <div>
                <label>Target:</label>
                <VsCodeRadioGroupVue v-model="outputTarget" :items="outputTargetItems" @change="handleChange()"
                  style="display: inline-block; margin-left: 20px;" />
              </div>
              <template v-if="outputTarget === 'file'">
                <div>
                  <label for="fileNamePrefix">Output file name prefix:</label>
                  <VsCodeTextField id="fileNamePrefix" v-model="fileNamePrefix" :maxlength="128" :transparent="true"
                    :change-on-mouseout="true" title="Output file name prefix" @change="($e: any) => handleChange()">
                  </VsCodeTextField>
                </div>
                <div>
                  <label>Compression:</label>
                  <VsCodeDropdown v-model="outputCompression" :items="outputCompressionItems" style="width: 200px;"
                    @change="handleChange()" />
                </div>
              </template>

            </fieldset>
            <fieldset v-for="(options, group) in optionGroups" :key="group" class="conditions">
              <legend>
                <span>{{ groupLabels[group] ?? group }}</span>
              </legend>

              <div class="option-list">
                <div v-for="opt in options" :key="opt.id" class="option-item">
                  <!-- checkbox -->
                  <label>
                    <input type="checkbox" v-model="opt.enabled" @change="($e: any) => handleChange()" />
                    {{ opt.description }}
                  </label>

                  <!-- argument input -->
                  <div v-if="opt.enabled && opt.argType" class="option-arg">
                    <!-- string -->
                    <VsCodeTextField v-if="opt.argType === 'string'" v-model="opt.param as string | number"
                      :change-on-mouseout="true" :placeholder="opt.option" :transparent="true"
                      @change="($e: any) => handleChange()" />

                    <!-- number -->
                    <VsCodeTextField v-else-if="opt.argType === 'number'" type="number"
                      v-model.number="opt.param as string | number" :change-on-mouseout="true" :transparent="true"
                      @change="($e: any) => handleChange()" />

                    <!-- enum -->
                    <VsCodeDropdown v-else-if="opt.argType === 'enum'" v-model="opt.param as string"
                      :items="(opt.enumValues ?? []).map(it => ({ label: it, value: it }))"
                      style="width: 200px;" @change="handleChange()" />
                  </div>

                  <!-- description detail -->
                  <small v-if="opt.descriptionDetail">
                    {{ opt.descriptionDetail }}
                  </small>
                </div>
              </div>
            </fieldset>

          </div>
        </fieldset>
      </div>
      <div v-if="targetScope !== 'database'" class="schemas content-child">
        <fieldset v-if="selectableSchema" class="conditions">
          <legend>Schemas</legend>
          <div class="scroll-wrapper">
            <div v-for="opt in schemaItems" :key="opt.value" class="schema-item">
              <label>
                <input type="checkbox" v-model="opt.selected" @change="($e: any) => handleChange()" />
                {{ opt.label }}
              </label>
            </div>
          </div>
        </fieldset>
        <fieldset v-if="targetScope === 'tables'" class="conditions">
          <legend>Tables</legend>
          <div class="scroll-wrapper" style="max-height: 350px;">
            <div v-for="opt in tableItems" :key="opt.value" class="table-item">
              <label>
                <input type="checkbox" v-model="opt.selected" @change="($e: any) => handleChange()" />
                {{ opt.label }}
              </label>
            </div>
          </div>
        </fieldset>
      </div>
      <div class="preview content-child">
        <fieldset class="conditions">
          <legend>Preview command</legend>
          <p class="preview" v-text="previewCommand"></p>
        </fieldset>
      </div>
    </section>
  </section>
</template>

<style lang="scss" scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 1px;
  padding: 1px;
  display: flex;
  flex-direction: column;
}

section.content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  gap: 3px;

  .content-child {
    flex: 1;

    &>fieldset {
      margin-top: 0;
    }
  }

  label {
    margin-top: 5px;
    display: inline-block;
    margin-right: 5px;
    min-width: 100px;
  }

  VsCodeTextField {
    size: 200px;
  }
}

.tool-left {
  label {
    margin-right: 5px;
  }

  label:nth-child(n+2) {
    margin-left: 25px;
  }

  span {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    max-width: 180px;
  }
}

fieldset.conditions {
  margin-top: 15px;
}

p.preview {
  margin: 5px;
  white-space: pre-wrap;
}

section.top-scroll-wrapper {
  overflow: auto;
}

div.content-child {
  .scroll-wrapper {
    overflow-y: auto;
    max-height: 180px;
  }
}
</style>
