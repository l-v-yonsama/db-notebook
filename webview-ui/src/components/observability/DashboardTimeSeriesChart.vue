<script setup lang="ts">
import type { CloudWatchPanelPresentation, DashboardTimeSeries } from "@/utilities/vscode";
import {
  Chart as ChartJS,
  BarElement,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  TimeScale,
  Title,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { computed } from "vue";
import { Bar, Line } from "vue-chartjs";

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  Filler,
  BarElement,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale
);

const props = defineProps<{
  panel: CloudWatchPanelPresentation;
  series: DashboardTimeSeries[];
}>();

const COLORS = ["#4f8cff", "#e06c75", "#48a868", "#d19a66", "#b477db", "#37a6a6"];

const chartData = computed<ChartData<"line", Array<{ x: string; y: number | null }>>>(() => {
  const datasets: ChartData<"line", Array<{ x: string; y: number | null }>>["datasets"] =
    props.series.map((item, index) => ({
      label: `${item.label} (${item.status})`,
      data: item.points,
      borderColor: COLORS[index % COLORS.length],
      backgroundColor: `${COLORS[index % COLORS.length]}33`,
      borderDash: item.status === "partial" ? [6, 4] : undefined,
      pointRadius: 1.5,
      borderWidth: 2,
      fill: props.panel.visualization === "stacked-area",
      spanGaps: false,
      stack: props.panel.visualization === "stacked-area" ? "metrics" : undefined,
    }));
  const timestamps = props.series.flatMap((item) => item.points.map((point) => point.x)).sort();
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  if (first && last) {
    for (const threshold of props.panel.thresholds ?? []) {
      datasets.push({
        label: `${threshold.label} (${threshold.severity})`,
        data: [
          { x: first, y: threshold.value },
          { x: last, y: threshold.value },
        ],
        borderColor: threshold.severity === "error" ? "#d9534f" : "#d9a441",
        borderDash: [8, 5],
        pointRadius: 0,
        borderWidth: 1,
        fill: false,
        spanGaps: false,
      });
    }
  }
  return { datasets };
});

// vue-chartjs currently narrows Line data to Chart.js' numeric Point type,
// while the time scale accepts ISO timestamp x values at runtime.
const renderData = computed(() => chartData.value as unknown as ChartData<"line">);

const barData = computed<ChartData<"bar", Array<{ x: string; y: number | null }>>>(() => ({
  datasets: props.series.map((item, index) => ({
    label: `${item.label} (${item.status})`,
    data: item.points,
    borderColor: COLORS[index % COLORS.length],
    backgroundColor: `${COLORS[index % COLORS.length]}88`,
    borderWidth: 1,
  })),
}));
const renderBarData = computed(() => barData.value as unknown as ChartData<"bar">);

const chartOptions = computed<ChartOptions<"line">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "nearest", intersect: false },
  plugins: {
    legend: { display: true, labels: { color: "#999" } },
    tooltip: { enabled: true },
  },
  scales: {
    x: {
      type: "time",
      ticks: { color: "#999", maxRotation: 0 },
      grid: { color: "rgba(127,127,127,0.18)" },
    },
    y: {
      beginAtZero: false,
      stacked: props.panel.visualization === "stacked-area",
      ticks: { color: "#999" },
      grid: { color: "rgba(127,127,127,0.18)" },
    },
  },
}));

const barOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "nearest", intersect: false },
  plugins: {
    legend: { display: true, labels: { color: "#999" } },
    tooltip: { enabled: true },
  },
  scales: {
    x: {
      type: "time",
      ticks: { color: "#999", maxRotation: 0 },
      grid: { color: "rgba(127,127,127,0.18)" },
    },
    y: {
      beginAtZero: true,
      ticks: { color: "#999" },
      grid: { color: "rgba(127,127,127,0.18)" },
    },
  },
}));
</script>

<template>
  <div class="chart" :aria-label="`${panel.title} time series chart`">
    <Bar v-if="panel.visualization === 'bar'" :data="renderBarData" :options="barOptions" />
    <Line v-else :data="renderData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  height: 280px;
  min-height: 220px;
}
</style>
