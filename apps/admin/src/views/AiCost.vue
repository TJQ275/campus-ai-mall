<template>
  <div>
    <h3 class="page-title">AI 成本</h3>
    <p class="muted">
      每一次模型调用都记在 ai_usage 表：谁用的、哪个场景、花了多少 token、折合多少钱。
      超预算后 AI 会自动降级到本地模式，不再产生费用。
    </p>

    <div class="toolbar">
      <el-radio-group v-model="days" @change="load">
        <el-radio-button :value="1">今天</el-radio-button>
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
      </el-radio-group>
      <el-button @click="load">刷新</el-button>
    </div>

    <!-- KPI -->
    <el-row :gutter="16">
      <el-col :span="4" v-for="card in kpiCards" :key="card.label">
        <el-card shadow="never">
          <div class="kpi-value">{{ card.value }}</div>
          <div class="kpi-label">{{ card.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 预算 -->
    <el-card shadow="never" style="margin-top: 16px">
      <template #header>
        <div class="card-head">
          <span>今日预算</span>
          <el-tag v-if="budget.overBudget" type="danger" size="small">已超支，AI 已降级到本地模式</el-tag>
          <el-tag v-else-if="budget.budgetMicro > 0" type="success" size="small">正常</el-tag>
          <el-tag v-else type="info" size="small">未设置上限</el-tag>
        </div>
      </template>
      <div class="budget-row">
        <span class="muted">日预算</span>
        <el-input-number v-model="budgetYuan" :min="0" :step="1" :precision="2" style="width: 160px" />
        <span class="muted">元（0 = 不限额）</span>
        <el-button type="primary" :loading="savingBudget" @click="saveBudget">保存</el-button>
        <span class="muted">今日已花 {{ yuan(budget.spentMicro / 1000000) }}</span>
      </div>
      <el-progress
        v-if="budget.budgetMicro > 0"
        :percentage="budget.usedPercent"
        :status="budget.overBudget ? 'exception' : 'success'"
        :stroke-width="14"
        style="margin-top: 12px"
      />
    </el-card>

    <!-- 图表 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="16">
        <el-card shadow="never">
          <template #header>费用趋势</template>
          <div ref="trendRef" style="height: 300px"></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>按模型</template>
          <div ref="modelRef" style="height: 300px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>按场景</template>
          <el-table :data="cost?.byScene ?? []" size="small">
            <el-table-column prop="scene" label="场景" />
            <el-table-column prop="calls" label="调用" width="90" />
            <el-table-column prop="costText" label="费用" width="110" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>按调用类型</template>
          <el-table :data="cost?.byKind ?? []" size="small">
            <el-table-column prop="kind" label="类型" />
            <el-table-column prop="calls" label="调用" width="90" />
            <el-table-column prop="costText" label="费用" width="110" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>费用最高的用户</template>
          <el-table :data="cost?.topUsers ?? []" size="small">
            <el-table-column prop="nickname" label="用户" />
            <el-table-column prop="calls" label="调用" width="90" />
            <el-table-column prop="costText" label="费用" width="110" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>费用最高的会话</template>
          <el-table :data="cost?.topConversations ?? []" size="small">
            <el-table-column prop="conversationId" label="会话 ID" width="110" />
            <el-table-column prop="calls" label="调用" width="90" />
            <el-table-column prop="costText" label="费用" width="110" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <!-- 价目表 -->
    <el-card shadow="never" style="margin-top: 16px">
      <template #header>
        <div class="card-head">
          <span>模型价目表</span>
          <!-- 这里原来用的是全角空格做分隔，ESLint 的 no-irregular-whitespace 不允许；改用 · 与页面其它位置保持一致 -->
          <span class="muted">版本 {{ prices?.version }} · 美元汇率 {{ prices?.usdToCny }}</span>
        </div>
      </template>
      <p class="muted">金额单位是「每百万 token」。账单对不上时改 apps/server/src/modules/ai/pricing.ts。</p>
      <el-table :data="prices?.items ?? []" size="small" max-height="320">
        <el-table-column prop="label" label="模型" width="220" />
        <el-table-column prop="match" label="匹配规则" width="180" />
        <el-table-column label="输入" width="110">
          <template #default="scope">{{ scope.row.currency === 'USD' ? '$' : '¥' }}{{ scope.row.inputPerMillion }}</template>
        </el-table-column>
        <el-table-column label="输出" width="110">
          <template #default="scope">{{ scope.row.currency === 'USD' ? '$' : '¥' }}{{ scope.row.outputPerMillion }}</template>
        </el-table-column>
        <el-table-column prop="note" label="备注" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { api, yuan, type AiBudget, type AiCost, type AiPriceRow } from '../api';
import { reportError } from '../composables/async';

// TitleComponent 用于空数据提示，按需引入模式下不注册它 title 会被静默忽略
echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

type ChartInstance = ReturnType<typeof echarts.init>;

const days = ref(7);
const cost = ref<AiCost | null>(null);
const prices = ref<{ version: string; usdToCny: number; items: AiPriceRow[] } | null>(null);
const budget = ref<AiBudget>({ budgetMicro: 0, spentMicro: 0, remainingMicro: 0, overBudget: false, usedPercent: 0 });
const budgetYuan = ref(0);
const savingBudget = ref(false);
const trendRef = ref<HTMLElement>();
const modelRef = ref<HTMLElement>();
const charts: ChartInstance[] = [];
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;

const kpiCards = computed(() => {
  const t = cost.value?.totals;
  return [
    { label: '总费用', value: t?.costText ?? '¥0' },
    { label: '模型调用', value: t?.calls ?? 0 },
    { label: '平均单次', value: t ? '¥' + (t.avgCostPerCallMicro / 1000000).toFixed(4) : '¥0' },
    { label: '降级率', value: (t?.degradedRate ?? 0) + '%' },
    { label: '覆盖会话', value: t?.conversations ?? 0 },
    { label: '覆盖用户', value: t?.users ?? 0 },
  ];
});

function emptyState(text: string) {
  return {
    title: {
      text, left: 'center', top: 'middle',
      textStyle: { color: '#a8abb2', fontSize: 13, fontWeight: 'normal' as const },
    },
  };
}

function observeResize() {
  if (typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      for (const chart of charts) if (!chart.isDisposed()) chart.resize();
    });
  });
  for (const element of [trendRef.value, modelRef.value]) if (element) resizeObserver.observe(element);
}

function disposeCharts() {
  for (const chart of charts) chart.dispose();
  charts.length = 0;
  resizeObserver?.disconnect();
  resizeObserver = null;
  cancelAnimationFrame(resizeFrame);
}

function renderCharts() {
  if (!trendRef.value || !modelRef.value) return;
  disposeCharts();
  const byDay = cost.value?.byDay ?? [];

  const trendChart = echarts.init(trendRef.value);
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['费用(元)', '调用次数'], top: 0, left: 'center' },
    grid: { left: 8, right: 8, top: 48, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: byDay.map((d) => d.day), axisTick: { alignWithLabel: true } },
    yAxis: [
      { type: 'value', name: '费用(元)' },
      { type: 'value', name: '调用次数', minInterval: 1 },
    ],
    series: [
      { name: '费用(元)', type: 'line', smooth: true, symbolSize: 6, data: byDay.map((d) => Number((d.costMicro / 1000000).toFixed(4))) },
      { name: '调用次数', type: 'bar', yAxisIndex: 1, barMaxWidth: 26, itemStyle: { color: 'rgba(103, 194, 58, 0.5)' }, data: byDay.map((d) => d.calls) },
    ],
    ...(byDay.length ? {} : emptyState('这段时间还没有调用记录')),
  });

  const byModel = (cost.value?.byModel ?? []).filter((m) => m.costMicro > 0);
  const modelChart = echarts.init(modelRef.value);
  modelChart.setOption({
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['40%', '68%'],
        showEmptyCircle: false,
        data: byModel.map((m) => ({ name: m.model, value: Number((m.costMicro / 1000000).toFixed(6)) })),
      },
    ],
    ...(byModel.length ? {} : emptyState('还没有产生费用')),
  });

  charts.push(trendChart, modelChart);
  observeResize();
}

async function load() {
  try {
    const [c, b, p] = await Promise.all([api.aiCost(days.value), api.aiBudget(), api.aiPrices()]);
    cost.value = c;
    budget.value = b;
    budgetYuan.value = Number((b.budgetMicro / 1000000).toFixed(2));
    prices.value = p;
    renderCharts();
  } catch (error) {
    reportError(error, '成本数据加载失败');
  }
}

async function saveBudget() {
  savingBudget.value = true;
  try {
    budget.value = await api.aiSetBudget(budgetYuan.value);
  } catch (error) {
    reportError(error, '预算保存失败');
  } finally {
    savingBudget.value = false;
  }
}

onMounted(load);
onBeforeUnmount(disposeCharts);
</script>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.budget-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>