<script setup lang="ts">
import { ref } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";
import VsCodeTextField from "./base/VsCodeTextField.vue";
import type {
  DbTable,
  ForeignKeyConstraintDetail,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { vscode, type ActionCommand, type ModeType } from "@/utilities/vscode";

type Props = {
  title: string;
};
const props = defineProps<Props>();

const cancel = () => {
  vscode.postCommand({
    command: "cancel",
    params: {},
  });
};
</script>

<template>
  <section class="root">
    <div class="toolbar">tool bars</div>
    <section>rule editor</section>
  </section>
</template>

<style scoped>
.root {
  width: 100%;
  margin: 1px;
  padding: 1px;
}
.toolbar {
  padding: 3px 4px;
  margin-bottom: 13px;
  display: flex;
}
</style>
