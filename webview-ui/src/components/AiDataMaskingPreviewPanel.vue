<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { AiDataMaskingPreviewPanelEventData, PreparedAiPayload } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import AiPayloadFindingViewer from "./AiPayloadFindingViewer.vue";
import VsCodeButton from "./base/VsCodeButton.vue";

const preview = ref<PreparedAiPayload>();
const findingViewer = ref<InstanceType<typeof AiPayloadFindingViewer>>();
const advanceAfterResolvedFindingId = ref<string>();
const selectedFindingId = ref<string>();
const candidateListElement = ref<HTMLElement>();
const candidateElements = new Map<string, HTMLElement>();
const unresolved = computed(
  () => preview.value?.findings.filter((finding) => finding.disposition === "unreviewed") ?? []
);
const allowed = computed(
  () => preview.value?.findings.filter((finding) => finding.disposition === "allowed").length ?? 0
);
const destinationLabel = computed(() =>
  preview.value?.destination === "mcp" ? "MCP client" : "Copilot Language Model Tool"
);

function setCandidateElement(element: unknown, findingId: string): void {
  if (element instanceof HTMLElement) {
    candidateElements.set(findingId, element);
  }
}

function selectFindingRow(findingId: string | undefined): void {
  selectedFindingId.value = findingId;
  if (findingId) {
    nextTick(() => {
      const container = candidateListElement.value;
      const element = candidateElements.get(findingId);
      if (!container || !element) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      if (elementRect.top < containerRect.top) {
        container.scrollTo({
          top: container.scrollTop + elementRect.top - containerRect.top,
          behavior: "smooth",
        });
      } else if (elementRect.bottom > containerRect.bottom) {
        container.scrollTo({
          top: container.scrollTop + elementRect.bottom - containerRect.bottom,
          behavior: "smooth",
        });
      }
    });
  }
}

const recieveMessage = (data: AiDataMaskingPreviewPanelEventData): void => {
  if (data.componentName !== "AiDataMaskingPreviewPanel") return;
  if (data.value.aiSendPreview) {
    candidateElements.clear();
    preview.value = data.value.aiSendPreview;
    const findingId = advanceAfterResolvedFindingId.value;
    advanceAfterResolvedFindingId.value = undefined;
    if (findingId) {
      nextTick(() => findingViewer.value?.focusNextAfterFinding(findingId));
    }
  }
};
defineExpose({ recieveMessage });

function resolve(
  findingId: string | undefined,
  disposition: "masked" | "allowed",
  strategy?: "partial" | "full",
  allCandidates = false
): void {
  if (!preview.value) return;
  if (findingId && !allCandidates) {
    advanceAfterResolvedFindingId.value = findingId;
  }
  vscode.postCommand({
    command: "resolveAiPayloadFinding",
    params: {
      requestId: preview.value.requestId,
      findingId,
      resolution: { disposition, strategy },
      allCandidates,
    },
  });
}

function approve(): void {
  if (!preview.value || unresolved.value.length) return;
  vscode.postCommand({
    command: "approveAiPayload",
    params: { requestId: preview.value.requestId, payloadDigest: preview.value.payloadDigest },
  });
}

function cancel(): void {
  if (!preview.value) return;
  vscode.postCommand({
    command: "cancelAiPayload",
    params: { requestId: preview.value.requestId },
  });
}

function findingText(finding: PreparedAiPayload["findings"][number]): string {
  const range = finding.ranges[0];
  return range && preview.value
    ? preview.value.payload.slice(range.start, range.end)
    : finding.label;
}
</script>

<template>
  <main class="AiDataMaskingPreviewPanel">
    <header>
      <div>
        <h2>AI Data Masking Preview</h2>
        <p v-if="preview">
          Destination: {{ destinationLabel }} · Masking level: {{ preview.level }}
        </p>
      </div>
      <VsCodeButton
        appearance="secondary"
        title="Close preview"
        aria-label="Close preview"
        @click="cancel"
      >
        <span class="codicon codicon-chrome-close" aria-hidden="true"></span>
      </VsCodeButton>
    </header>

    <template v-if="preview">
      <p class="warning">
        Review the complete payload. It is not returned to the AI client until you approve it.
      </p>
      <p v-if="preview.truncation" class="warning">
        Payload truncated: approximately
        {{ preview.truncation.omittedApproxBytes.toLocaleString() }} bytes omitted.
      </p>
      <div class="summary">
        <span>Masked: {{ preview.findings.filter((f) => f.disposition === "masked").length }}</span>
        <span>Unreviewed: {{ unresolved.length }}</span>
        <span>Allowed: {{ allowed }}</span>
        <VsCodeButton
          v-if="unresolved.length"
          appearance="secondary"
          @click="resolve(undefined, 'masked', 'full', true)"
        >
          Mask all candidates
        </VsCodeButton>
      </div>
      <div v-if="unresolved.length" ref="candidateListElement" class="candidates">
        <div
          v-for="finding in unresolved"
          :key="finding.id"
          :ref="(element) => setCandidateElement(element, finding.id)"
          :class="['candidate', { selected: selectedFindingId === finding.id }]"
          @click="findingViewer?.focusFinding(finding.id)"
        >
          <code>{{ findingText(finding) }}</code>
          <span>{{ finding.label }}</span>
          <VsCodeButton
            appearance="secondary"
            @click.stop="resolve(finding.id, 'masked', 'partial')"
            >Partial</VsCodeButton
          >
          <VsCodeButton appearance="secondary" @click.stop="resolve(finding.id, 'masked', 'full')"
            >Full</VsCodeButton
          >
          <VsCodeButton appearance="secondary" @click.stop="resolve(finding.id, 'allowed')"
            >Keep unmasked</VsCodeButton
          >
        </div>
      </div>
      <AiPayloadFindingViewer
        ref="findingViewer"
        :payload="preview.payload"
        :findings="preview.findings"
        @selection-change="selectFindingRow"
      />
      <footer>
        <span v-if="allowed" class="warning"
          >{{ allowed }} candidate(s) will be sent unmasked.</span
        >
        <VsCodeButton appearance="secondary" @click="cancel">Cancel</VsCodeButton>
        <VsCodeButton :disabled="unresolved.length > 0" @click="approve"
          >Approve and Return</VsCodeButton
        >
      </footer>
    </template>
  </main>
</template>

<style scoped lang="scss">
.AiDataMaskingPreviewPanel {
  box-sizing: border-box;
  display: flex;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding: clamp(8px, 2vw, 20px);
  overflow: hidden;
}
header,
footer,
.summary,
.candidate {
  display: flex;
  align-items: center;
  gap: 12px;
}
header {
  flex: 0 0 auto;
  justify-content: space-between;
}
header > div {
  min-width: 0;
}
header h2 {
  margin: 0;
}
.warning {
  color: var(--vscode-editorWarning-foreground);
  overflow-wrap: anywhere;
}
.summary {
  flex-wrap: wrap;
  margin: 16px 0;
}
.candidates {
  flex: 0 0 auto;
  min-width: 0;
  width: 100%;
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--vscode-panel-border);
}
.candidate {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  flex-wrap: wrap;
  padding: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  cursor: pointer;
}
.candidate.selected {
  background: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent);
  box-shadow: inset 3px 0 var(--vscode-focusBorder);
}
.candidate code {
  min-width: 80px;
  max-width: 240px;
  flex: 0 1 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.candidate > span {
  min-width: 120px;
  flex: 1 1 180px;
}
footer {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: 12px;
}
.AiDataMaskingPreviewPanel > .finding-viewer {
  min-width: 0;
  min-height: 0;
  width: 100%;
  flex: 1 1 auto;
}
</style>
