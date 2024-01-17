<script setup lang="ts">
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
</script>

<template>
  <section>
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
          </p>
        </td>
      </tr>
    </table>
  </section>
</template>

<style scoped>
section {
  display: block;
  width: 100%;
}
p {
  margin: 1px 2px;
  font-size: x-small;
}
th {
  text-align: right;
}
td {
  text-align: left;
}
.ellipsis {
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
