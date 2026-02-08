<script setup lang="ts">
import type { DropdownItem } from "@/types/Components";
import type {
  DBRestoreInputParams,
  DBRestoreSettingsPanelEventData,
  RestoreFileCompressionType
} from "@/utilities/vscode";
import {
  vscode,
} from "@/utilities/vscode";
import { toNum } from "@l-v-yonsama/rdh";
import { computed, nextTick, onMounted, ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";

const sectionHeight = ref(300);

const DUMP_FILE_FILTERS: { [name: string]: string[] } = {
  DUMP: ["sql", "dump", "gz", "zst"],
  "SQL dump files": ["sql"],
  "Compressed SQL dumps": ["gz", "zst"],
  All: ["*"],
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

const disabledReasonMessage = computed<string | null>(() => {
  if (!initialized.value) {
    return 'Initializing...';
  }

  if (!inputFilePath.value.trim()) {
    return 'Dump file is required';
  }

  // Docker 実行時
  if (executeRestoreInDockerContainer.value && !dockerContainerName.value) {
    return 'Docker container is not selected';
  }

  return null;
});

const dbType = ref('MySQL' as DBRestoreInputParams['dbType']);
const initialized = ref(false);
const executeRestoreInDockerContainer = ref(false);
const userName = ref("");
const password = ref("");
const host = ref("");
const port = ref<number | undefined>(undefined);
const inputFilePath = ref("");
const previewCommand = ref("");
const dockerContainerName = ref('');
const dockerContainerItems: DropdownItem[] = [];
const showProgress = ref(false);
const verbose = ref(false);
const deleteExistingSqliteDb = ref(false);

const fileCompression = ref<RestoreFileCompressionType>('none');

const fileCompressionItems: DropdownItem[] = [
  { label: "None (plain SQL file)", value: "none" },
  { label: "gzip (.gz)", value: "gzip" },
  { label: "zstd (.zst)", value: "zstd" },
];

const initialize = async (v: DBRestoreSettingsPanelEventData["value"]["initialize"]) => {
  initialized.value = false;
  await nextTick();
  if (v === undefined) {
    initialized.value = true;
    return;
  }

  dbType.value = v.params.dbType;
  inputFilePath.value = v.params.inputFilePath ?? "";
  fileCompression.value = v.params.fileCompression ?? 'none';

  showProgress.value = v.params.advanced.showProgress;
  verbose.value = v.params.advanced.verbose;
  deleteExistingSqliteDb.value = v.params.sqliteOption?.deleteExistingDb ?? false;

  executeRestoreInDockerContainer.value = v.params.executeRestoreInDockerContainer;
  dockerContainerItems.splice(0, dockerContainerItems.length);
  dockerContainerItems.push({
    label: '', value: ''
  });
  v.uiParams.dockerContainerItems.forEach(it => {
    dockerContainerItems.push(it);
  });
  dockerContainerName.value = v.params.dockerContainerName ?? '';

  userName.value = v.params.userName ?? '';
  password.value = v.params.password ?? '';
  host.value = v.params.host ?? '';
  port.value = v.params.port;
  previewCommand.value = v.uiParams.previewCommand;

  initialized.value = true;

  await nextTick();
  const wrapper = document.querySelector("section.scroll-wrapper");
  if (wrapper) {
    wrapper.scrollTop = v.uiParams.scrollPos ?? 0;
  }
};

function selectFile(targetAttribute: string, title: string, filters?: { [name: string]: string[] }) {
  vscode.postCommand({
    command: "selectFileActionCommand",
    params: {
      targetAttribute,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title,
      filters,
    },
  });
}

const handleChange = () => {
  const lastKnownScrollPosition = document.querySelector(".scroll-wrapper")?.scrollTop ?? 0;

  const params: Partial<DBRestoreInputParams> = {
    inputFilePath: inputFilePath.value,
    fileCompression: fileCompression.value,
    userName: userName.value,
    password: password.value,
    host: host.value,
    port: toNum(port.value),
    executeRestoreInDockerContainer: executeRestoreInDockerContainer.value,
    dockerContainerName: dockerContainerName.value,
    advanced: {
      showProgress: showProgress.value,
      verbose: verbose.value
    }
  };
  if (dbType.value === "SQLite") {
    params.sqliteOption = {
      deleteExistingDb: deleteExistingSqliteDb.value,
    };
  }
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

const recieveMessage = (data: DBRestoreSettingsPanelEventData) => {
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
        <VsCodeButton @click="ok" title="Run restore command" :disabled="!!disabledReasonMessage">
          <fa icon="check" />Run Restore
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
            <fieldset class="conditions" v-if="dbType !== 'SQLite'">
              <legend>
                <span style="margin-right: 30px">Base</span>
              </legend>
              <div>
                <label>
                  <input type="checkbox" v-model="executeRestoreInDockerContainer"
                    @change="($e: any) => handleChange()" />
                  Run restore inside Docker container
                </label>
                <br>
                <small>When enabled, the restore command is executed inside the selected Docker container instead of on
                  your local machine..</small>
              </div>
              <div v-if="executeRestoreInDockerContainer">
                <label for="dockerContainerName"> Container name:</label>
                <VsCodeDropdown id="dockerContainerName" v-model="dockerContainerName" :items="dockerContainerItems"
                  style="z-index: 25; width: 320px;" :required="true" @change="handleChange()" />
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
                  :change-on-mouseout="true" title="Input password" @change="($e: any) => handleChange()">
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
                <span style="margin-right: 30px">Dump file <VsCodeButton
                    @click="selectFile('database', 'Select a dump file.', DUMP_FILE_FILTERS)" style="margin-left:8px">
                    <fa icon="file" />Select
                  </VsCodeButton></span>
              </legend>
              <div>
                <label for="inputFilePath">Path:</label>
                <span v-if="inputFilePath.length > 0" id="inputFilePath">{{ inputFilePath }}</span>
                <span v-else id="inputFilePath">No dump file selected.</span>
              </div>
              <div>
                <label>Compression format:</label>
                <VsCodeDropdown v-model="fileCompression" :items="fileCompressionItems" style="width: 200px;"
                  @change="handleChange()" />
                <br>
                <small>Select the compression format used when the dump file was created.</small>
              </div>
            </fieldset>
            <fieldset class="advanced">
              <legend>
                <span style="margin-right: 30px">Advanced</span>
              </legend>
              <div>
                <label>
                  <input type="checkbox" v-model="showProgress" @change="($e: any) => handleChange()" />
                  Show restore progress (requires pv)
                </label>
                <br>
                <small> Displays transfer progress while restoring.
                  Requires <code>pv</code> (Pipe Viewer) to be installed on your local machine.</small>
              </div>
              <div>
                <label>
                  <input type="checkbox" v-model="verbose" @change="($e: any) => handleChange()" />
                  Verbose output (debug / large logs)
                </label>
                <br>
                <small>Prints executed SQL statements during restore.
                  Useful for debugging, but may produce a large amount of output.</small>
              </div>
              <!-- SQLite 専用 -->
              <div v-if="dbType === 'SQLite'" style="margin-top: 10px;">
                <label>
                  <input type="checkbox" v-model="deleteExistingSqliteDb" @change="($e: any) => handleChange()" />
                  Delete existing SQLite database before restore
                </label>
                <br />
                <small style="color: var(--vscode-errorForeground);">
                  ⚠️ The existing database file will be permanently deleted before restoring.
                </small>
              </div>
            </fieldset>

          </div>
        </fieldset>
      </div>
      <div class="preview content-child">
        <fieldset class="conditions">
          <legend>Restore command preview</legend>
          <small>
            This is the command that will be executed in the terminal.
            Passwords are masked in preview.
          </small>
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
