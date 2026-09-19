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

    <el-card shadow="never" style="margin-top: 16px">
      <template #header>AI 工具调用分布</template>
      <el-table :data="aiStats.byTool" size="small">
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
import { computed, onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import { api, yuan } from '../api';

const kpi = ref<Record<string, number>>({});
const trend = ref<Record<string, any>[]>([]);
const categorySales = ref<Record<string, any>[]>([]);
const payChannels = ref<Record<string, any>[]>([]);
const aiStats = ref<{ byTool: any[]; totals: Record<string, number>; mode: any }>({ byTool: [], totals: {}, mode: {} });
const insight = ref<{ model: string; points: string[]; suggestion: string }>({ model: 'template', points: [], suggestion: '' });
const trendRef = ref<HTMLElement>();
const categoryRef = ref<HTMLElement>();
const channelRef = ref<HTMLElement>();

const kpiCards = computed(() => [
  { label: '订单总数', value: kpi.value.order_count ?? 0 },
  { label: '成交金额', value: yuan(kpi.value.paid_cents ?? 0) },
  { label: '用户数', value: kpi.value.user_count ?? 0 },
  { label: '商品数', value: kpi.value.product_count ?? 0 },
  { label: '待处理售后', value: kpi.value.pending_after_sale ?? 0 },
  { label: 'AI 促成订单', value: kpi.value.ai_order_count ?? 0 },
]);

onMounted(async () => {
  const data = await api.dashboard();
  kpi.value = data.kpi;
  trend.value = data.trend as Record<string, any>[];
  categorySales.value = data.categorySales as Record<string, any>[];
  payChannels.value = data.payChannels as Record<string, any>[];
  aiStats.value = (await api.aiStats(30)) as any;
  insight.value = (await api.insight()) as any;

  const trendChart = echarts.init(trendRef.value!);
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['订单数', '成交额(元)'] },
    grid: { left: 40, right: 40, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: trend.value.map((t) => t.day) },
    yAxis: [{ type: 'value' }, { type: 'value' }],
    series: [
      { name: '订单数', type: 'line', smooth: true, data: trend.value.map((t) => t.orders) },
      { name: '成交额(元)', type: 'bar', yAxisIndex: 1, data: trend.value.map((t) => (t.amount / 100).toFixed(2)) },
    ],
  });

  const categoryChart = echarts.init(categoryRef.value!);
  categoryChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 90, right: 30, top: 20, bottom: 30 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: categorySales.value.map((c) => c.name).reverse() },
    series: [{ type: 'bar', data: categorySales.value.map((c) => c.qty).reverse(), itemStyle: { color: '#67c23a' } }],
  });

  const channelChart = echarts.init(channelRef.value!);
  const channelLabel: Record<string, string> = { wechat: '微信', alipay: '支付宝', balance: '余额', unpaid: '未支付' };
  channelChart.setOption({
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['40%', '68%'],
        data: payChannels.value.map((c) => ({ name: channelLabel[c.channel] || c.channel, value: c.count })),
      },
    ],
  });

  window.addEventListener('resize', () => {
    trendChart.resize();
    categoryChart.resize();
    channelChart.resize();
  });
});
</script>
