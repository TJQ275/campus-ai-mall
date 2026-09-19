<template>
  <div>
    <h3 class="page-title">订单管理</h3>
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="订单号" style="width: 220px" clearable @keyup.enter="search" />
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 160px" @change="search">
        <el-option v-for="(label, value) in ORDER_STATUS_LABEL" :key="value" :label="label" :value="value" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <el-table :data="rows" size="small" v-loading="loading">
      <el-table-column type="expand">
        <template #default="scope">
          <el-table :data="scope.row.items" size="small">
            <el-table-column prop="titleSnapshot" label="商品" min-width="220" />
            <el-table-column label="单价" width="100"><template #default="s">{{ yuan(s.row.priceCents) }}</template></el-table-column>
            <el-table-column prop="quantity" label="数量" width="80" />
            <el-table-column prop="refundStatus" label="售后" width="110" />
          </el-table>
        </template>
      </el-table-column>
      <el-table-column prop="orderNo" label="订单号" width="200" />
      <el-table-column label="金额" width="100"><template #default="scope">{{ yuan(scope.row.payCents) }}</template></el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="scope"><el-tag size="small">{{ ORDER_STATUS_LABEL[scope.row.status] || scope.row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column label="来源" width="100">
        <template #default="scope">
          <el-tag size="small" :type="scope.row.source === 'ai' ? 'success' : 'info'">{{ scope.row.source === 'ai' ? 'AI 助手' : '用户下单' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="下单时间" min-width="180" />
      <el-table-column label="操作" width="110">
        <template #default="scope">
          <el-button v-if="scope.row.status === 'paid'" link type="primary" @click="ship(scope.row)">发货</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 16px"
      layout="prev, pager, next, total"
      :total="total"
      :page-size="query.pageSize"
      :current-page="query.page"
      @current-change="onPage"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { api, ORDER_STATUS_LABEL, yuan } from '../api';
import { confirmAction, runAction } from '../composables/async';
import { useTable } from '../composables/useTable';

const { rows, total, loading, query, load, search, onPage } = useTable(
  (q, signal) => api.orders(q, signal),
  { keyword: '', status: '', page: 1, pageSize: 10 },
);

async function ship(row: Record<string, any>) {
  // 发货不可撤销，点一下就发出去太危险
  if (!(await confirmAction('确认把订单 ' + row.orderNo + ' 标记为已发货？'))) return;
  await runAction(async () => {
    await api.ship(row.id);
    ElMessage.success('已发货');
    await load();
  }, '发货失败');
}

onMounted(load);
</script>
