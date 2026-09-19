<template>
  <div>
    <h3 class="page-title">售后管理</h3>
    <p class="muted">同意退款后会自动把金额退回用户余额，并回滚库存与销量。</p>
    <div class="toolbar">
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 160px" @change="search">
        <el-option v-for="(label, value) in AFTER_SALE_STATUS_LABEL" :key="value" :label="label" :value="value" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <el-table :data="rows" size="small" v-loading="loading">
      <el-table-column prop="afterSaleNo" label="售后单号" width="200" />
      <el-table-column prop="reason" label="原因" width="140" />
      <el-table-column prop="description" label="说明" min-width="180" />
      <el-table-column label="金额" width="100"><template #default="scope">{{ yuan(scope.row.amountCents) }}</template></el-table-column>
      <el-table-column label="来源" width="100">
        <template #default="scope">
          <el-tag size="small" :type="scope.row.source === 'ai' ? 'success' : 'info'">{{ scope.row.source === 'ai' ? 'AI 代提交' : '用户申请' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="scope"><el-tag size="small">{{ AFTER_SALE_STATUS_LABEL[scope.row.status] || scope.row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="createdAt" label="申请时间" min-width="180" />
      <el-table-column label="操作" width="160">
        <template #default="scope">
          <template v-if="scope.row.status === 'pending'">
            <el-button link type="success" @click="audit(scope.row, true)">同意退款</el-button>
            <el-button link type="danger" @click="audit(scope.row, false)">拒绝</el-button>
          </template>
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
import { AFTER_SALE_STATUS_LABEL, api, yuan } from '../api';
import { confirmAction, runAction } from '../composables/async';
import { useTable } from '../composables/useTable';

const { rows, total, loading, query, load, search, onPage } = useTable(
  (q, signal) => api.afterSales(q, signal),
  { status: '', page: 1, pageSize: 10 },
);

async function audit(row: Record<string, any>, approve: boolean) {
  // 同意退款会真的动钱，确认一次
  const message = approve
    ? '同意退款 ' + yuan(row.amountCents) + '？金额会退回用户余额并回滚库存与销量。'
    : '确认拒绝售后单 ' + row.afterSaleNo + '？';
  if (!(await confirmAction(message, '审核售后'))) return;
  await runAction(async () => {
    await api.auditAfterSale(row.id, approve, approve ? '审核通过' : '不符合退款条件');
    ElMessage.success(approve ? '已退款并入账' : '已拒绝');
    await load();
  }, '审核失败');
}

onMounted(load);
</script>
