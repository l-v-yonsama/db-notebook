<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  DBDumpOptionParams,
  DBExportSettingsInputParams,
  DBExportSettingsPanelEventData,
  OutputCompressionType
} from "@/utilities/vscode";
import {
  vscode,
} from "@/utilities/vscode";
import type {
  DbTable
} from "@l-v-yonsama/multi-platform-database-drivers";
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeRadioGroupVue from "./base/VsCodeRadioGroup.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

const sectionHeight = ref(300);

type TableItem = {
  name: string;
  comment: string;
  selected: boolean;
};

window.addEventListener("resize", () => resetSectionHeight());

const resetSectionHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 76, 100);
  }
};

onMounted(() => {
  nextTick(resetSectionHeight);
});

const groupLabels: Record<string, string> = {
  target: "Target",
  content: "Content",
  filter: "Filter",
  performance: "Performance",
  compat: "Compatibility",
  advanced: "Advanced (Danger)",
};

const optionGroups = computed(() => {
  const map: Record<string, DBDumpOptionParams[]> = {};

  for (const opt of dumpOptions.value) {
    if (!map[opt.group]) {
      map[opt.group] = [];
    }
    map[opt.group].push(opt);
  }

  return map;
});

const dbType = ref('MySQL' as DBExportSettingsInputParams['dbType']);
const initialized = ref(false);
const executeDumpInDockerContainer = ref(false);
const userName = ref("");
const password = ref("");
const fileNamePrefix = ref("");
const previewCommand = ref("");
const targetScope = ref("database" as "database" | 'tables');
const targetScopeItems: DropdownItem[] = [
  { label: 'Database', value: 'database' },
  { label: 'Tables', value: 'tables' },
];
const dockerContainerName = ref('');
const dockerContainerItems: DropdownItem[] = [];

const outputTarget = ref<"stdout" | "file">("file");
const outputFormat = ref<"sql" | "csv" | "binary" | "directory">("sql");
const outputCompression = ref<OutputCompressionType>('none');
const outputTargetItems: DropdownItem[] = [
  { label: "Standard output", value: "stdout" },
  { label: "File", value: "file" },
];

const outputFormatItems: DropdownItem[] = [
  { label: "SQL (plain)", value: "sql" },
  { label: "Binary", value: "binary" },
  { label: "Directory", value: "directory" },
];

const outputCompressionItems: DropdownItem[] = [
  { label: "None", value: "none" },
  { label: "Gzip", value: "gzip" },
  { label: "Zstd", value: "zstd" },
];


const allTableItems = ref([] as TableItem[]);
const dumpOptions = ref<DBDumpOptionParams[]>([]);
let tables: DbTable[] = [];

const initialize = async (v: DBExportSettingsPanelEventData["value"]["initialize"]) => {
  initialized.value = false;
  await nextTick();
  if (v === undefined) {
    initialized.value = true;
    return;
  }

  dbType.value = v.params.dbType;
  outputTarget.value = v.params.outputTarget ?? "file";
  outputFormat.value = v.params.outputFormat ?? "sql";
  outputCompression.value = v.params.outputCompression ?? 'none';
  fileNamePrefix.value = v.params.outputFilePrefix ?? "";

  executeDumpInDockerContainer.value = v.params.executeDumpInDockerContainer;
  dockerContainerItems.splice(0, dockerContainerItems.length);
  dockerContainerItems.push({
    label: '', value: ''
  });
  v.uiParams.dockerContainerItems.forEach(it => {
    dockerContainerItems.push(it);
  });
  dockerContainerName.value = v.params.dockerContainerName;

  tables = v.uiParams.tables as DbTable[];
  userName.value = v.params.userName;
  password.value = v.params.password;
  dumpOptions.value = v.params.options;
  previewCommand.value = v.uiParams.previewCommand;

  allTableItems.value.splice(0, allTableItems.value.length);
  v.uiParams.tables.forEach((table) => {
    allTableItems.value.push({
      name: table.name,
      comment: table.comment ?? "",
      selected: v.params.selectedTables.includes(table.name),
    });
  });
  initialized.value = true;

  await nextTick();
  const wrapper = document.querySelector("section.scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = v.uiParams.scrollPos ?? 0;
  }
};

function selectTable(tableItem: TableItem) {
  tableItem.selected = true;
  // resetAll(tableItem, true);
}

const handleChange = () => {
  const lastKnownScrollPosition = document.querySelector(".scroll-wrapper")?.scrollTop ?? 0;

  const params: Partial<DBExportSettingsInputParams> = {
    outputTarget: outputTarget.value,
    outputFormat: outputFormat.value,
    outputFilePrefix: fileNamePrefix.value,
    outputCompression: outputCompression.value,
    userName: userName.value,
    password: password.value,
    targetScope: targetScope.value,
    executeDumpInDockerContainer: executeDumpInDockerContainer.value,
    dockerContainerName: dockerContainerName.value,
    selectedTables: allTableItems.value.filter(it => it.selected).map(it => it.name),
    options: JSON.parse(JSON.stringify(dumpOptions.value)),
  };
  vscode.postCommand({
    command: "inputChange",
    params:{
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

const recieveMessage = (data: DBExportSettingsPanelEventData) => {
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
        <h3>DB export settings</h3>
      </div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel">
          <fa icon="times" />Cancel
        </VsCodeButton>
        <VsCodeButton @click="writeToClipboard" appearance="secondary" title="Write to clipboard">
          <fa icon="clipboard" />Copy to clipboard
        </VsCodeButton>
        <VsCodeButton @click="ok" title="Execute in a terminal">
          <fa icon="check" />Execute
        </VsCodeButton>
      </div>
    </div>
    <section v-if="!initialized" class="centered-content">Just a moment, please.</section>
    <section v-else class="content scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <div class="params content-child">
        <fieldset class="conditions">
          <legend>
            <span style="margin-right: 30px">Options</span>
          </legend>
          <div>
            <fieldset class="conditions">
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
                  style="z-index: 25; width: 320px;" @change="handleChange()" />
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
                <div v-if="dbType === 'Postgres'">
                  <label>Output format:</label>
                  <VsCodeDropdown v-model="outputFormat" :items="outputFormatItems" style="width: 200px;"
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
                      style="z-index: 25; width: 200px;" @change="handleChange()" />
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
      <div v-if="targetScope === 'tables'" class="tables content-child">
        <fieldset class="conditions">
          <legend>Tables</legend>
          <div v-for="opt in allTableItems" :key="opt.name" class="table-item">
            <label>
              <input type="checkbox" v-model="opt.selected" @change="($e: any) => handleChange()" />
              {{ opt.name }}&nbsp;<small v-if="opt.comment">({{ opt.comment }})</small>
            </label>
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

section.scroll-wrapper {
  overflow: auto;
}
</style>
