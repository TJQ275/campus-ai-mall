<template>
  <div>
    <h3 class="page-title">售后管理</h3>
    <p class="muted">同意退款后会自动把金额退回用户余额，并回滚库存与销量。</p>
    <div class="toolbar">
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 160px" @change="load">
        <el-option label="待审核" value="pending" />
        <el-option label="已退款" value="refunded" />
        <el-option label="已拒绝" value="rejected" />
        <el-option label="已撤销" value="cancelled" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table :data="rows" size="small">
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
        <template #default="scope"><el-tag size="small">{{ STATUS_LABEL[scope.row.status] || scope.row.status }}</el-tag></template>
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
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, yuan, STATUS_LABEL } from '../api';

const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const query = reactive({ status: '', page: 1, pageSize: 10 });

async function load() {
  const data = await api.afterSales({ ...query });
  rows.value = data.list;
  total.value = data.total;
}

function onPage(page: number) {
  query.page = page;
  load();
}

async function audit(row: Record<string, any>, approve: boolean) {
  await api.auditAfterSale(row.id, approve, approve ? '审核通过' : '不符合退款条件');
  ElMessage.success(approve ? '已退款并入账' : '已拒绝');
  await load();
}

onMounted(load);
</script>
