<template>
  <div>
    <h3 class="page-title">数据概览</h3>

    <el-row :gutter="16">
      <el-col :span="4" v-for="card in kpiCards" :key="card.label">
        <el-card shadow="never">
          <div class="kpi-value">{{ card.value }}</div>
          <div class="kpi-label">{{ card.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="16">
        <el-card shadow="never">
          <template #header>近 14 天成交趋势</template>
          <div ref="trendRef" style="height: 300px"></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>支付渠道分布</template>
          <div ref="channelRef" style="height: 300px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>分类销量</template>
          <div ref="categoryRef" style="height: 300px"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>AI 经营快报</template>
          <el-tag size="small" :type="insight.model === 'template' ? 'info' : 'success'">
            {{ insight.model === 'template' ? '模板归纳（未配置大模型）' : insight.model }}
          </el-tag>
          <ul style="padding-left: 18px; line-height: 1.9; margin-top: 12px">
            <li v-for="point in insight.points" :key="point">{{ point }}</li>
          </ul>
          <el-alert type="success" :closable="false" show-icon :title="insight.suggestion" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 向量检索静默降级告警：不显式提示的话，检索质量退化了也没人会发现 -->
    <el-alert
      v-if="aiStats.embeddingHealth?.failing"
      type="warning"
      :closable="false"
      show-icon
      style="margin-top: 16px"
      title="向量检索已失效，当前在用关键词兜底"
    >
      <div>模型：{{ aiStats.embeddingHealth.model }}</div>
      <div>错误：{{ aiStats.embeddingHealth.lastError }}</div>
      <div v-if="aiStats.embeddingHealth.hint" style="margin-top: 6px">建议：{{ aiStats.embeddingHealth.hint }}</div>
    </el-alert>

    <el-alert
      v-if="aiStats.rerankHealth?.enabled && aiStats.rerankHealth?.failing"
      type="warning"
      :closable="false"
      show-icon
      style="margin-top: 16px"
      title="重排服务不可达，已自动跳过重排"
    >
      <div>地址：{{ aiStats.rerankHealth.baseUrl }}</div>
      <div>错误：{{ aiStats.rerankHealth.lastError }}</div>
      <div v-if="aiStats.rerankHealth.hint" style="margin-top: 6px">建议：{{ aiStats.rerankHealth.hint }}</div>
    </el-alert>

    <el-card shadow="never" style="margin-top: 16px">
      <template #header>AI 工具调用分布</template>
      <el-table :data="aiStats.byTool" size="small" v-loading="loading">
        <el-table-column prop="toolName" label="工具" />
        <el-table-column prop="calls" label="调用次数" width="110" />
        <el-table-column prop="avgMs" label="平均耗时" width="110">
          <template #default="scope">{{ scope.row.avgMs }} ms</template>
        </el-table-column>
        <el-table-column prop="errors" label="失败" width="90" />
        <el-table-column prop="pendingCount" label="待确认" width="90" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
// 只引入用到的图表与组件，避免把整个 echarts 打进 Dashboard chunk
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { api, PAY_CHANNEL_LABEL, yuan, type AiStats, type DashboardData } from '../api';
import { reportError } from '../composables/async';

// TitleComponent 是「空数据提示」用的：按需引入模式下没注册它，setOption 里的 title 会被静默忽略
echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

type ChartInstance = ReturnType<typeof echarts.init>;

const kpi = ref<Record<string, number>>({});
const trend = ref<DashboardData['trend']>([]);
const categorySales = ref<DashboardData['categorySales']>([]);
const payChannels = ref<DashboardData['payChannels']>([]);
const aiStats = ref<AiStats>({
  byTool: [], totals: {}, trend: [],
  mode: { provider: '', model: '', mock: true, embedding: '' },
  embeddingEnabled: false,
  embeddingHealth: { enabled: false, model: null, failing: false, lastError: null, lastErrorAt: null, hint: null },
  rerankHealth: { enabled: false, baseUrl: null, failing: false, lastError: null, lastErrorAt: null, lastSuccessAt: null, hint: null },
});
const insight = ref<{ model: string; points: string[]; suggestion: string }>({ model: 'template', points: [], suggestion: '' });
const loading = ref(false);
const trendRef = ref<HTMLElement>();
const categoryRef = ref<HTMLElement>();
const channelRef = ref<HTMLElement>();

const charts: ChartInstance[] = [];
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;

const kpiCards = computed(() => [
  { label: '订单总数', value: kpi.value.order_count ?? 0 },
  { label: '成交金额', value: yuan(kpi.value.paid_cents ?? 0) },
  { label: '用户数', value: kpi.value.user_count ?? 0 },
  { label: '商品数', value: kpi.value.product_count ?? 0 },
  { label: '待处理售后', value: kpi.value.pending_after_sale ?? 0 },
  { label: 'AI 促成订单', value: kpi.value.ai_order_count ?? 0 },
]);

/** 容器尺寸变化才需要重绘；离开页面时 ResizeObserver 会和图表一起断开 */
function observeResize() {
  if (typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      for (const chart of charts) {
        if (!chart.isDisposed()) chart.resize();
      }
    });
  });
  for (const element of [trendRef.value, channelRef.value, categoryRef.value]) {
    if (element) resizeObserver.observe(element);
  }
}

function disposeCharts() {
  for (const chart of charts) chart.dispose();
  charts.length = 0;
  resizeObserver?.disconnect();
  resizeObserver = null;
  cancelAnimationFrame(resizeFrame);
}

/**
 * 空数据时的图表兜底：ECharts 在数据为空时不会报错，但会画出一个空坐标轴
 * 或者一个灰色空环，看起来像页面坏了。统一换成一句居中的提示。
 */
function emptyState(text: string) {
  return {
    title: {
      text,
      left: 'center',
      top: 'middle',
      textStyle: { color: '#a8abb2', fontSize: 13, fontWeight: 'normal' as const },
    },
  };
}

function renderCharts() {
  // 数据回来前组件可能已经卸载，此时 ref 为 null：再 init 只会留下没人回收的实例
  if (!trendRef.value || !channelRef.value || !categoryRef.value) return;
  disposeCharts();

  const trendChart = echarts.init(trendRef.value);
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    // 图例要给明确位置：不给时 ECharts 的 auto 定位会掉到图表底部，把 X 轴的日期盖住
    legend: { data: ['订单数', '成交额(元)'], top: 0, left: 'center' },
    // containLabel 让坐标轴文字也算进网格内，标签不会再被图形压住或裁掉
    grid: { left: 8, right: 8, top: 48, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: trend.value.map((t) => t.day), axisTick: { alignWithLabel: true } },
    yAxis: [
      { type: 'value', name: '订单数', minInterval: 1 },
      { type: 'value', name: '成交额(元)' },
    ],
    series: [
      { name: '订单数', type: 'line', smooth: true, symbolSize: 6, data: trend.value.map((t) => t.orders) },
      {
        name: '成交额(元)',
        type: 'bar',
        yAxisIndex: 1,
        // 限宽 + 半透明：只有一两天有数据时，柱子不该糊满整个图表
        barMaxWidth: 26,
        itemStyle: { color: 'rgba(103, 194, 58, 0.5)' },
        data: trend.value.map((t) => Number((t.amount / 100).toFixed(2))),
      },
    ],
  });

  const categoryChart = echarts.init(categoryRef.value);
  const hasCategorySales = categorySales.value.some((c) => c.qty > 0);
  categoryChart.setOption(
    hasCategorySales
      ? {
          tooltip: { trigger: 'axis' },
          grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
          xAxis: { type: 'value', minInterval: 1 },
          yAxis: { type: 'category', data: categorySales.value.map((c) => c.name).reverse() },
          series: [
            {
              type: 'bar',
              barMaxWidth: 20,
              itemStyle: { color: '#67c23a' },
              data: categorySales.value.map((c) => c.qty).reverse(),
            },
          ],
        }
      : // 没有销量时不要把空坐标轴画出来，否则提示文字会和分类名挤在一起
        emptyState('还没有销量数据'),
  );

  const channelChart = echarts.init(channelRef.value);
  // 没有订单时：ECharts 饼图默认会画一个浅灰色的「空数据圈」，看起来像页面坏了，
  // 所以关掉它、改成一句提示
  const hasChannels = payChannels.value.length > 0;
  channelChart.setOption({
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['40%', '68%'],
        showEmptyCircle: false,
        data: payChannels.value.map((c) => ({ name: PAY_CHANNEL_LABEL[c.channel] || c.channel, value: c.count })),
      },
    ],
    ...(hasChannels ? {} : emptyState('还没有支付记录')),
  });

  charts.push(trendChart, categoryChart, channelChart);
  observeResize();
}

async function loadAll() {
  loading.value = true;
  try {
    const [data, stats, report] = await Promise.all([api.dashboard(), api.aiStats(30), api.insight()]);
    kpi.value = data.kpi;
    trend.value = data.trend ?? [];
    categorySales.value = data.categorySales ?? [];
    payChannels.value = data.payChannels ?? [];
    aiStats.value = stats;
    insight.value = report;
    renderCharts();
  } catch (error) {
    reportError(error, '概览数据加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);
// 图表实例与 ResizeObserver 必须一起释放，否则每次进入本页都会泄漏
onBeforeUnmount(disposeCharts);
</script>
