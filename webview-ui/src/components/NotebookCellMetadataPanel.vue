<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from "vue";
import { vscode } from "@/utilities/vscode";
import type { NotebookCellMetadataPanelEventData } from "@/utilities/vscode";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeDropdown from "./base/VsCodeDropdown.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import { vsCodeCheckbox, provideVSCodeDesignSystem } from "@vscode/webview-ui-toolkit";
import type { DropdownItem } from "@/types/Components";

provideVSCodeDesignSystem().register(vsCodeCheckbox());

window.addEventListener("resize", () => resetSpPaneWrapperHeight());

const codeFileItems: DropdownItem[] = [];
const ruleFileItems: DropdownItem[] = [];
const showComment = ref(false);
const codeResolverFile = ref("");
const ruleFile = ref("");
const markWithinQuery = ref(true);
const markWithExplain = ref(false);
const markWithExplainAnalyze = ref(false);
const savingSharedVariables = ref(false);
const sharedVariableName = ref("");

const initialized = ref(false);
const sectionHeight = ref(300);

const errorMessage = computed(() => {
  if (!markWithinQuery.value && !markWithExplain.value && !markWithExplainAnalyze.value) {
    return "Please select at least one.";
  }

  return "";
});

const resetSpPaneWrapperHeight = () => {
  const sectionWrapper = window.document.querySelector("section.root");
  if (sectionWrapper?.clientHeight) {
    sectionHeight.value = Math.max(sectionWrapper?.clientHeight - 56, 100);
  }
};

const initialize = (v: NotebookCellMetadataPanelEventData["value"]["initialize"]): void => {
  if (v === undefined) {
    return;
  }
  initialized.value = false;

  nextTick(() => {
    showComment.value = v.metadata.showComment === true;
    markWithinQuery.value = v.metadata.markWithinQuery === true;
    markWithExplain.value = v.metadata.markWithExplain === true;
    markWithExplainAnalyze.value = v.metadata.markWithExplainAnalyze === true;

    codeResolverFile.value = v.metadata.codeResolverFile ?? "";
    ruleFile.value = v.metadata.ruleFile ?? "";

    v.codeFileItems.map((it) => {
      codeFileItems.push({ label: it.label, value: it.value });
    });
    v.ruleFileItems.map((it) => {
      ruleFileItems.push({ label: it.label, value: it.value });
    });

    savingSharedVariables.value = v.metadata.savingSharedVariables === true;
    sharedVariableName.value = v.metadata.sharedVariableName ?? "";

    initialized.value = true;
  });
};

onMounted(() => {
  nextTick(resetSpPaneWrapperHeight);
  setTimeout(resetSpPaneWrapperHeight, 50);
  setTimeout(resetSpPaneWrapperHeight, 200);
});

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};

const save = () => {
  vscode.postCommand({
    command: "saveNotebookCellMetadata",
    params: {
      metadata: {
        showComment: showComment.value,
        codeResolverFile: codeResolverFile.value,
        ruleFile: ruleFile.value,
        markWithinQuery: markWithinQuery.value,
        markWithExplain: markWithExplain.value,
        markWithExplainAnalyze: markWithExplainAnalyze.value,
        savingSharedVariables: savingSharedVariables.value,
        sharedVariableName: sharedVariableName.value,
      },
    },
  });
};

const recieveMessage = (data: NotebookCellMetadataPanelEventData) => {
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

const disabledSaveButton = computed(
  () =>
    errorMessage.value.length > 0 ||
    (savingSharedVariables.value && sharedVariableName.value.length === 0)
);

defineExpose({
  recieveMessage,
});
</script>

<template>
  <section class="root">
    <div class="toolbar">
      <div class="tool-left"></div>
      <div class="tool-right">
        <VsCodeButton @click="cancel" appearance="secondary" title="Cancel"
          ><fa icon="times" />Cancel</VsCodeButton
        >
        <VsCodeButton :disabled="disabledSaveButton" @click="save" title="Save cell metadata"
          ><fa icon="plus" />Save</VsCodeButton
        >
      </div>
    </div>
    <section v-if="!initialized" class="content">Initializing...</section>
    <section v-else class="content scroll-wrapper" :style="{ height: `${sectionHeight}px` }">
      <fieldset>
        <legend>SQL Editor</legend>
        <div>
          <vscode-checkbox
            :checked="showComment"
            @change="($e:any) => showComment =$e.target.checked"
            style="margin-right: auto"
            >Display comments after each resource</vscode-checkbox
          >
        </div>
      </fieldset>
      <fieldset>
        <legend>Execute SQL mode</legend>
        <div>
          <div>
            <vscode-checkbox
              :checked="markWithinQuery"
              @change="($e:any) => markWithinQuery =$e.target.checked"
              style="margin-right: auto"
              >Execute query</vscode-checkbox
            >
          </div>
          <div>
            <vscode-checkbox
              :checked="markWithExplain"
              @change="($e:any) => markWithExplain =$e.target.checked"
              style="margin-right: auto"
              >Execute explain (Devises a query plan)</vscode-checkbox
            >
          </div>
          <div>
            <vscode-checkbox
              :checked="markWithExplainAnalyze"
              @change="($e:any) => markWithExplainAnalyze =$e.target.checked"
              style="margin-right: auto"
              >Execute explain analyze (Displays actual execution time and
              statistics)</vscode-checkbox
            >
          </div>
          <p v-text="errorMessage" class="marker-error"></p>
        </div>
      </fieldset>
      <fieldset>
        <legend>Resultset decoration</legend>
        <div>
          <p>Resolve code values to labels and display them in the resultset</p>
          <VsCodeDropdown id="codeFileItems" v-model="codeResolverFile" :items="codeFileItems" />
        </div>
      </fieldset>
      <fieldset>
        <legend>Resultset validation</legend>
        <div>
          <p>Verify each records by the record rule file</p>
          <VsCodeDropdown id="ruleFileItems" v-model="ruleFile" :items="ruleFileItems" />
        </div>
      </fieldset>
      <fieldset>
        <legend>Saving execution results in shared variables</legend>
        <div>
          <div>
            <vscode-checkbox
              :checked="savingSharedVariables"
              @change="($e:any) => savingSharedVariables =$e.target.checked"
              style="margin-right: auto"
              >Save</vscode-checkbox
            >
          </div>
          <div v-if="savingSharedVariables">
            <label for="sharedVariableName">shared variable name:</label>
            <VsCodeTextField
              id="sharedVariableName"
              v-model="sharedVariableName"
              :required="true"
              :maxlength="50"
              :transparent="true"
              :change-on-mouseout="true"
              title="Shared variable name"
            >
            </VsCodeTextField>
          </div>
        </div>
      </fieldset>
    </section>
  </section>
</template>

<style lang="scss" scoped>
section.root {
  display: block;
  width: 100%;
  height: 100vh;
  position: relative;

  & > * {
    margin: 10px;
  }
}

fieldset {
  margin-bottom: 15px;
}
.scroll-wrapper {
  overflow: auto;
}

#sharedVariableName {
  margin-left: 5px;
}
</style>
