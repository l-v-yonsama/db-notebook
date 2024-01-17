<template>
  <div class="file-annotation">
    <template v-if="annotation">
      <template v-if="renderType === 'Image'">
        <a v-if="annotation.downloadUrl" :href="annotation.downloadUrl">
          <img class="thumbnail" :src="createImageUrl()" />
        </a>
        <img v-else class="thumbnail" :src="createImageUrl()" />
      </template>
      <template v-else-if="renderType === 'Video'">
        <a v-if="annotation.downloadUrl" :href="annotation.downloadUrl">Download</a>
        <span v-else>Video file</span>
      </template>
      <template v-else-if="renderType === 'Audio'">
        <a v-if="annotation.downloadUrl" :href="annotation.downloadUrl">Download</a>
        <span v-else>Audio file</span>
      </template>
      <div v-else-if="renderType === 'Text'" class="preview-text">
        <a v-if="annotation.downloadUrl" :href="annotation.downloadUrl">
          <span v-text="createDownloadText()"></span>
        </a>
        <span v-else>{{ text }}</span>
      </div>
      <div v-else>
        <a v-if="annotation.downloadUrl" :href="annotation.downloadUrl">Download</a>
        <span v-else>Binary file</span>
      </div>
    </template>
    <template v-else>
      <span>{{ text }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { FileAnnotation } from "@l-v-yonsama/multi-platform-database-drivers";
import { ref } from "vue";

const props = defineProps<{
  text: string;
  annotation: FileAnnotation["values"];
}>();

const renderType = ref(props.annotation?.contentTypeInfo.renderType ?? "Unknown");

const createImageUrl = (): string => {
  if (props.text) {
    if (props.annotation?.contentTypeInfo.contentType?.toLocaleLowerCase() === "image/svg+xml") {
      return `data:image/svg+xml,${encodeURIComponent(props.text)}`;
    }
    return `data:${props.annotation?.contentTypeInfo?.contentType};base64,${props.text}`;
  }
  return props.annotation?.downloadUrl ?? "";
};

const createVideoOrAudioUrl = (): string => {
  if (props.text) {
    return `data:${props.annotation?.contentTypeInfo?.contentType};base64,${props.text}`;
  }
  return props.annotation?.downloadUrl ?? "";
};

const createDownloadText = (): string => {
  if (props.text) {
    return props.text;
  }
  return "Download";
};
</script>
<style scoped>
img.thumbnail {
  max-height: 64px;
  max-width: 208px;
}

video.video-thumbnail {
  max-height: 164px;
  max-width: 208px;
}

div.preview-text {
  position: relative;
  display: inline-block;
  margin: 5px 1px;
  text-overflow: ellipsis;
  overflow: hidden;
  max-height: 64px;
  min-height: 15px;
  width: 208px;
  max-width: 208px;
}
</style>
