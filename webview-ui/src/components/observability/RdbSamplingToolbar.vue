<script setup lang="ts">
import VsCodeButton from "@/components/base/VsCodeButton.vue";
import type { RdbSamplingStatePayload } from "@/utilities/vscode";
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  sampling: RdbSamplingStatePayload;
  allowedIntervalMs: readonly number[];
  loading: boolean;
  updating?: boolean;
}>();
const emit = defineEmits<{
  (event: "start", intervalMs: number): void;
  (event: "stop"): void;
  (event: "interval", intervalMs: number): void;
  (event: "refresh"): void;
  (event: "cancel"): void;
  (event: "export"): void;
  (event: "close"): void;
}>();

function intervalChanged(event: Event): void {
  emit("interval", Number((event.target as HTMLSelectElement).value));
}

function formatInterval(value: number): string {
  return value < 60_000 ? `${value / 1000}s` : `${value / 60_000}m`;
}

const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

const stateLabel = computed(() => {
  const labels: Record<RdbSamplingStatePayload["state"], string> = {
    stopped: "Sampling stopped",
    starting: "Starting sampling",
    running: "Sampling",
    stopping: "Stopping sampling",
    error: "Sampling error",
  };
  return labels[props.sampling.state];
});

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}

const elapsed = computed(() =>
  props.sampling.sessionStartedAt
    ? formatDuration(now.value - Date.parse(props.sampling.sessionStartedAt))
    : undefined
);
const nextSample = computed(() => {
  if (!props.sampling.nextSampleAt || props.sampling.state !== "running") {
    return undefined;
  }
  return Math.max(0, Math.ceil((Date.parse(props.sampling.nextSampleAt) - now.value) / 1000));
});

onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now();
  }, 1_000);
});
onUnmounted(() => {
  if (clock) {
    clearInterval(clock);
  }
});
</script>

<template>
  <div class="sampling-toolbar" role="toolbar" aria-label="Database dashboard controls">
    <label>
      <span>Sample interval</span>
      <select :value="sampling.intervalMs" aria-label="Sample interval" @change="intervalChanged">
        <option v-for="value in allowedIntervalMs" :key="value" :value="value">
          {{ formatInterval(value) }}
        </option>
      </select>
    </label>
    <div class="sampling-status" role="status" aria-live="polite">
      <strong
        >{{ stateLabel }}<template v-if="elapsed"> · {{ elapsed }}</template></strong
      >
      <small v-if="sampling.message">{{ sampling.message }}</small>
      <small v-else-if="nextSample !== undefined">
        Next sample in {{ nextSample }}s<span v-if="sampling.lastSampleDurationMs !== undefined">
          · last duration {{ sampling.lastSampleDurationMs }}ms</span
        >
      </small>
      <small v-else-if="sampling.lastSampleAt"
        >Last sample {{ new Date(sampling.lastSampleAt).toLocaleTimeString() }}</small
      >
      <small v-else>History is not available before this dashboard session.</small>
    </div>
    <span class="updating" :class="{ visible: updating }" role="status" :aria-hidden="!updating"
      >Updating…</span
    >
    <VsCodeButton
      v-if="sampling.state === 'running'"
      appearance="secondary"
      title="Stop periodic sampling"
      @click="$emit('stop')"
    >
      <span class="codicon codicon-debug-stop button-icon" aria-hidden="true"></span>
      Stop sampling
    </VsCodeButton>
    <VsCodeButton
      v-else
      appearance="primary"
      title="Start periodic sampling"
      @click="$emit('start', props.sampling.intervalMs)"
    >
      <span class="codicon codicon-play button-icon" aria-hidden="true"></span>
      Start sampling
    </VsCodeButton>
    <VsCodeButton v-if="loading" appearance="secondary" @click="$emit('cancel')"
      >Cancel</VsCodeButton
    >
    <VsCodeButton
      v-else
      title="Refresh metrics now"
      appearance="secondary"
      :disabled="updating"
      @click="$emit('refresh')"
    >
      <span class="codicon codicon-refresh button-icon" aria-hidden="true"></span>
      Refresh now
    </VsCodeButton>
    <VsCodeButton
      title="Export current snapshot to notebook"
      appearance="secondary"
      @click="$emit('export')"
    >
      <span class="codicon codicon-export button-icon" aria-hidden="true"></span>
      Export to Notebook
    </VsCodeButton>
    <VsCodeButton
      title="Close dashboard"
      aria-label="Close dashboard"
      appearance="secondary"
      @click="$emit('close')"
    >
      <span class="codicon codicon-chrome-close" aria-hidden="true"></span>
    </VsCodeButton>
  </div>
</template>

<style scoped>
.sampling-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
}
label,
.sampling-status {
  display: grid;
  gap: 3px;
}
label span,
small,
.updating {
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
}
.sampling-status {
  margin-right: auto;
  min-width: 220px;
}
select {
  padding: 4px 24px 4px 7px;
  color: var(--vscode-dropdown-foreground);
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
}
.button-icon {
  margin-right: 6px;
}
.updating {
  visibility: hidden;
  min-width: 72px;
}
.updating.visible {
  visibility: visible;
}
</style>
