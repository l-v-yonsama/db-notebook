<script setup lang="ts">
import type { AiMaskingFinding } from "@/utilities/vscode";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import VsCodeButton from "./base/VsCodeButton.vue";

const props = defineProps<{
  payload: string;
  findings: AiMaskingFinding[];
}>();
const emit = defineEmits<{
  (event: "selectionChange", findingId: string | undefined): void;
}>();

type FindingLocation = {
  finding: AiMaskingFinding;
  start: number;
  end: number;
};

type PayloadSegment = {
  text: string;
  locationIndex?: number;
  finding?: AiMaskingFinding;
};

const selectedLocationIndex = ref(0);
const payloadElement = ref<HTMLElement>();
const locationElements = new Map<number, HTMLElement>();

const locations = computed<FindingLocation[]>(() =>
  props.findings
    .flatMap((finding) =>
      finding.ranges.map((range) => ({
        finding,
        start: Math.max(0, range.start),
        end: Math.min(props.payload.length, range.end),
      }))
    )
    .filter((location) => location.start < location.end)
    .sort((a, b) => a.start - b.start || a.end - b.end)
);

// Ranges are expected to be disjoint. Clipping defensively keeps malformed or
// overlapping host data from duplicating payload text in the preview.
const segments = computed<PayloadSegment[]>(() => {
  const result: PayloadSegment[] = [];
  let cursor = 0;
  locations.value.forEach((location, locationIndex) => {
    const start = Math.max(cursor, location.start);
    if (start > cursor) {
      result.push({ text: props.payload.slice(cursor, start) });
    }
    if (location.end > start) {
      result.push({
        text: props.payload.slice(start, location.end),
        locationIndex,
        finding: location.finding,
      });
      cursor = location.end;
    }
  });
  if (cursor < props.payload.length) {
    result.push({ text: props.payload.slice(cursor) });
  }
  return result;
});

const selectedLocation = computed(() => locations.value[selectedLocationIndex.value]);

function setLocationElement(element: unknown, locationIndex: number): void {
  if (element instanceof HTMLElement) {
    locationElements.set(locationIndex, element);
  }
}

function scrollToSelected(): void {
  nextTick(() => {
    const container = payloadElement.value;
    const element = locationElements.get(selectedLocationIndex.value);
    if (!container || !element) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    let left = container.scrollLeft;
    if (elementRect.left < containerRect.left) {
      left += elementRect.left - containerRect.left;
    } else if (elementRect.right > containerRect.right) {
      left += elementRect.right - containerRect.right;
    }
    container.scrollTo({
      top:
        container.scrollTop +
        elementRect.top -
        containerRect.top -
        (container.clientHeight - elementRect.height) / 2,
      left,
      behavior: "smooth",
    });
  });
}

function selectLocation(locationIndex: number): void {
  if (!locations.value.length) {
    return;
  }
  selectedLocationIndex.value = Math.min(Math.max(locationIndex, 0), locations.value.length - 1);
  scrollToSelected();
}

function moveSelection(offset: number): void {
  const count = locations.value.length;
  if (!count) {
    return;
  }
  selectLocation((selectedLocationIndex.value + offset + count) % count);
}

function focusFinding(findingId: string): void {
  const index = locations.value.findIndex((location) => location.finding.id === findingId);
  if (index >= 0) {
    selectLocation(index);
  }
}

function focusNextAfterFinding(findingId: string): void {
  const count = locations.value.length;
  if (!count) {
    return;
  }
  const selected = locations.value[selectedLocationIndex.value];
  const index =
    selected?.finding.id === findingId
      ? selectedLocationIndex.value
      : locations.value.findIndex((location) => location.finding.id === findingId);
  if (index >= 0) {
    selectLocation((index + 1) % count);
  }
}

function dispositionLabel(finding: AiMaskingFinding): string {
  if (finding.disposition === "masked") {
    return "Masked";
  }
  if (finding.disposition === "allowed") {
    return "Allowed";
  }
  return "Candidate / Unreviewed";
}

function singleLine(value: string): string {
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function middleEllipsis(value: string, maxLength = 80): string {
  const text = singleLine(value);
  if (text.length <= maxLength) {
    return text;
  }
  const sideLength = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, sideLength)}...${text.slice(-sideLength)}`;
}

function originalPreview(finding: AiMaskingFinding): string {
  return middleEllipsis(finding.originalText);
}

function locationPreview(location: FindingLocation): string {
  return middleEllipsis(props.payload.slice(location.start, location.end));
}

function findingTitle(finding: AiMaskingFinding, sentText: string): string {
  return `${dispositionLabel(finding)}: ${finding.label}\nOriginal: ${finding.originalText}\nSent: ${sentText}`;
}

watch(
  () => [props.payload, props.findings] as const,
  () => {
    locationElements.clear();
    selectedLocationIndex.value = 0;
    scrollToSelected();
  }
);
watch(
  () => selectedLocation.value?.finding.id,
  (findingId) => emit("selectionChange", findingId),
  { immediate: true }
);

onMounted(scrollToSelected);

defineExpose({ focusFinding, focusNextAfterFinding });
</script>

<template>
  <section class="finding-viewer" aria-label="AI payload findings">
    <div class="finding-toolbar">
      <div class="legend" aria-label="Highlight legend">
        <span><i class="swatch masked"></i>Masked</span>
        <span><i class="swatch unreviewed"></i>Candidate</span>
        <span v-if="findings.some((finding) => finding.disposition === 'allowed')"
          ><i class="swatch allowed"></i>Allowed</span
        >
      </div>
      <div v-if="locations.length" class="finding-navigation">
        <VsCodeButton appearance="secondary" title="Previous finding" @click="moveSelection(-1)">
          <span
            class="codicon codicon-chevron-left navigation-icon previous"
            aria-hidden="true"
          ></span>
          Previous
        </VsCodeButton>
        <strong>{{ selectedLocationIndex + 1 }} / {{ locations.length }}</strong>
        <VsCodeButton appearance="secondary" title="Next finding" @click="moveSelection(1)">
          Next
          <span
            class="codicon codicon-chevron-right navigation-icon next"
            aria-hidden="true"
          ></span>
        </VsCodeButton>
        <span class="selected-label">{{ selectedLocation?.finding.label }}</span>
        <span
          v-if="selectedLocation"
          class="selected-original"
          :title="`Original: ${selectedLocation.finding.originalText}`"
        >
          Original: <code>{{ originalPreview(selectedLocation.finding) }}</code>
        </span>
      </div>
      <span v-else>No highlighted findings</span>
      <details v-if="locations.length" class="finding-list">
        <summary>Findings ({{ locations.length }})</summary>
        <div class="finding-list-items">
          <button
            v-for="(location, index) in locations"
            :key="`${location.finding.id}:${index}`"
            type="button"
            :class="[location.finding.disposition, { selected: index === selectedLocationIndex }]"
            @click="selectLocation(index)"
          >
            <span>{{ index + 1 }}. {{ dispositionLabel(location.finding) }}</span>
            <code :title="`Original: ${location.finding.originalText}`"
              >Original: {{ originalPreview(location.finding) }}</code
            >
            <code :title="`Sent: ${payload.slice(location.start, location.end)}`"
              >Sent: {{ locationPreview(location) }}</code
            >
            <small>{{ location.finding.label }}</small>
          </button>
        </div>
      </details>
    </div>

    <pre ref="payloadElement" class="payload"><template v-for="(segment, index) in segments" :key="index"><mark
          v-if="segment.finding && segment.locationIndex !== undefined"
          :ref="(element) => setLocationElement(element, segment.locationIndex!)"
          :class="[
            segment.finding.disposition,
            { selected: segment.locationIndex === selectedLocationIndex },
          ]"
          :title="findingTitle(segment.finding, segment.text)"
          role="button"
          tabindex="0"
          @click="selectLocation(segment.locationIndex)"
          @keydown.enter.prevent="selectLocation(segment.locationIndex)"
          @keydown.space.prevent="selectLocation(segment.locationIndex)"
          >{{ segment.text }}</mark
        ><template v-else>{{ segment.text }}</template></template></pre>
  </section>
</template>

<style scoped lang="scss">
.finding-viewer {
  display: flex;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  min-height: 220px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--vscode-input-border);
}
.finding-toolbar,
.legend,
.finding-navigation,
.legend span {
  display: flex;
  align-items: center;
}
.finding-toolbar {
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editorGroupHeader-tabsBackground);
}
.navigation-icon.previous {
  margin-right: 4px;
}
.navigation-icon.next {
  margin-left: 4px;
}
.legend,
.finding-navigation {
  gap: 8px;
}
.finding-navigation {
  min-width: 0;
  flex: 1 1 420px;
  flex-wrap: wrap;
}
.legend span {
  gap: 4px;
}
.swatch {
  width: 10px;
  height: 10px;
  border: 1px solid var(--vscode-contrastBorder, transparent);
}
.swatch.masked,
mark.masked {
  background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 38%, transparent);
}
.swatch.unreviewed,
mark.unreviewed {
  background: color-mix(in srgb, var(--vscode-editorError-foreground) 35%, transparent);
}
.swatch.allowed,
mark.allowed {
  background: color-mix(in srgb, var(--vscode-testing-iconPassed) 35%, transparent);
}
.selected-label {
  max-width: 280px;
  overflow: hidden;
  color: var(--vscode-descriptionForeground);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selected-original {
  display: flex;
  min-width: 0;
  max-width: min(440px, 38vw);
  gap: 4px;
  overflow: hidden;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}
.selected-original code {
  overflow: hidden;
  color: var(--vscode-foreground);
  text-overflow: ellipsis;
}
.finding-list {
  position: relative;
  margin-left: auto;
}
.finding-list summary {
  cursor: pointer;
  user-select: none;
}
.finding-list-items {
  position: absolute;
  z-index: 2;
  top: calc(100% + 6px);
  right: 0;
  width: min(760px, 85vw);
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-menu-background);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.finding-list button {
  box-sizing: border-box;
  display: grid;
  width: 100%;
  grid-template-columns: 135px minmax(140px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr);
  gap: 8px;
  padding: 7px 8px;
  color: var(--vscode-menu-foreground);
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--vscode-panel-border);
  cursor: pointer;
}
.finding-list button:hover,
.finding-list button.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.finding-list code,
.finding-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.payload {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  min-height: 0;
  margin: 0;
  padding: 10px;
  overflow: auto;
  color: var(--vscode-editor-foreground);
  background: var(--vscode-textCodeBlock-background);
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  line-height: 1.4;
  white-space: pre;
}
mark {
  color: inherit;
  cursor: pointer;
  outline-offset: 1px;
}
mark.selected {
  outline: 2px solid var(--vscode-focusBorder);
}
mark:focus-visible {
  outline: 2px solid var(--vscode-focusBorder);
}
</style>
