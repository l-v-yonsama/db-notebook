<script setup lang="ts">
import { nextTick, ref } from "vue";
import { toPng } from "html-to-image";
import ChartDataLabels from "chartjs-plugin-datalabels";
import "chartjs-adapter-date-fns";
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  TimeScale,
} from "chart.js";

import { Bar, Scatter } from "vue-chartjs";

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  ChartDataLabels,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  TimeScale
);

interface Props {
  title: string;
  showTitle: boolean;
  pairPlotChartParams: any;
  height: number;
}

const props = withDefaults(defineProps<Props>(), {
  title: "",
  showTitle: false,
  hue: "",
  height: 150,
  pairPlotChartParams: () => ({} as unknown as any),
});

const isCapturing = ref(false);

const getBase64Image = async (id: string): Promise<string> => {
  var node = document.getElementById(id);
  if (!node) {
    return "";
  }
  isCapturing.value = true;
  await nextTick();
  const v = await toPng(node);
  isCapturing.value = false;
  return v;
};

defineExpose({ getBase64Image });
</script>

<template>
  <div
    class="pair-plot-chart"
    :style="{
      backgroundColor: isCapturing ? 'white' : '',
      height: isCapturing ? '' : `${height}px`,
    }"
  >
    <p v-if="showTitle" class="title">{{ title }}</p>
    <div class="legends" v-if="pairPlotChartParams.hueLegends.length > 0">
      <div
        class="legend"
        v-for="(hueLegend, idx) of pairPlotChartParams.hueLegends"
        :key="hueLegend.title"
        :style="{ 'border-color': `${hueLegend.color}`, 'color': `${hueLegend.color}` }"
      >
        {{ hueLegend.pointSymbol }}: {{ hueLegend.title }}
      </div>
    </div>
    <table>
      <tbody>
        <tr>
          <th class="rl">&nbsp;</th>
          <th v-for="(matrix, ri) in pairPlotChartParams.matrix[0]" :key="matrix.colName">
            {{ matrix.colName }}
          </th>
        </tr>
        <tr v-for="(matrixRow, ci) in pairPlotChartParams.matrix" :key="ci">
          <th>
            <div class="rl">
              <small>{{ matrixRow[0].rowName }}</small>
            </div>
          </th>
          <td v-for="(matrix, ri) in matrixRow" :key="ri">
            <Bar
              v-if="matrix.type === 'histogram'"
              :data="matrix.chartParams?.data"
              :options="matrix.chartParams?.options"
            />
            <Scatter
              v-else-if="matrix.type === 'scatter'"
              :data="matrix.chartParams?.data"
              :options="matrix.chartParams?.options"
            />
            <div
              v-else-if="matrix.type === 'correlation'"
              class="correlation"
              :class="[matrix.correlation?.category]"
            >
              R = {{ (matrix.correlation?.value ?? 0).toFixed(2) }}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style lang="scss" scoped>
.root {
  width: 100%;
  height: 100%;
  margin: 1px;
  padding: 1px;
}

.pair-plot-chart {
  overflow-y: auto;
  p.title {
    text-align: center;
    margin: 2px 0;
  }
  .legends {
    text-align: center;
    div.legend {
      display: inline-block;
      min-width: 3em;
      padding: 0px 5px;
      margin-right: 2em;
      border-width: 2px;
      border-style: solid;
      line-height: 1.2;
    }
    margin-bottom: 1px;
  }
  table {
    table-layout: fixed;
    width: 100%;

    th {
      font-weight: normal;
      background-color: #e0e0e0;
      text-align: center;
      &.rl {
        width: 1.2em;
        text-align: center;
      }
      div.rl {
        line-height: 0.9em;
        width: 1.2em;
        text-align: center;
        white-space: pre-line;
        overflow: hidden;
        writing-mode: vertical-rl;
      }
    }
    td {
      vertical-align: middle;
      border: 1px dotted silver;
      text-align: center;

      .very_weak {
        color: #999;
        font-size: small;
      }
      .weak {
        color: #666;
      }
      .moderate {
        color: #333;
        font-size: large;
      }
      .strong {
        color: #511;
        font-size: x-large;
      }
      .very_strong {
        color: #822;
        font-size: xx-large;
      }
    }
    .correlation {
      text-align: center;
    }
  }
}
</style>
