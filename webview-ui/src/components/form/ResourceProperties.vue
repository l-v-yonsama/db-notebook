<script setup lang="ts">
import VsCodeButton from "../base/VsCodeButton.vue";
type Props = {
  values: { [key: string]: string };
};

const props = defineProps<Props>();
const list = Object.entries(props.values).map(([k, v]) => ({
  k,
  v,
}));

const abbr = (s: string, len: number) => {
  const slen = s.length;
  if (slen <= len) {
    return s;
  }
  const halfLen = Math.floor(len / 2) - 1;
  return s.substring(0, halfLen) + "..." + s.substring(s.length - halfLen);
};

const copyToClipboard = (text: string) => {
  navigator?.clipboard?.writeText(text);
};
</script>

<template>
  <section class="wrapper">
    <table>
      <tr v-for="(item, idx) of list" :key="idx">
        <th>
          <p :title="item.k">
            {{ abbr(item.k, 24) }}
          </p>
        </th>
        <td>
          <p class="ellipsis" :title="item.v">
            {{ item.v }}
            <VsCodeButton @click.stop="copyToClipboard(item.v)" appearance="secondary" class="copy-to-clipboard xxs">
              <fa icon="clipboard" size="xs" />
            </VsCodeButton>
          </p>
        </td>
      </tr>
    </table>
  </section>
</template>

<style scoped>
section {
  display: block;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
}

p {
  font-size: small;
  margin: 0;
  height: 20px;
}

.copy-to-clipboard {
  position: absolute;
  right: 4px;
  top: 0;
}

table {
  width: 100%;
}

th {
  text-align: right;
  font-weight: normal;
}

td {
  text-align: left;
  padding-left: 4px;
}

.ellipsis {
  max-width: 160px;
  min-width: 80px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.7;
}

p.ellipsis {
  position: relative;
}
</style>
