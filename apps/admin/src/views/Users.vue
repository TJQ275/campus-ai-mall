<template>
  <div>
    <h3 class="page-title">用户管理</h3>
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="昵称 / openid / 手机号" style="width: 240px" clearable @keyup.enter="load" />
      <el-select v-model="query.role" placeholder="全部角色" clearable style="width: 150px">
        <el-option label="普通用户" value="user" />
        <el-option label="管理员" value="admin" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table :data="rows" size="small">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="nickname" label="昵称" width="150" />
      <el-table-column prop="openid" label="openid" min-width="180" />
      <el-table-column label="角色" width="100"><template #default="scope">{{ scope.row.role === 'admin' ? '管理员' : '用户' }}</template></el-table-column>
      <el-table-column label="余额" width="110"><template #default="scope">{{ yuan(scope.row.balanceCents) }}</template></el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="scope"><el-tag size="small" :type="scope.row.status === 1 ? 'success' : 'danger'">{{ scope.row.status === 1 ? '正常' : '禁用' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="createdAt" label="注册时间" min-width="180" />
      <el-table-column label="操作" width="200">
        <template #default="scope">
          <el-button link type="primary" @click="toggle(scope.row)">{{ scope.row.status === 1 ? '禁用' : '启用' }}</el-button>
          <el-button link type="success" @click="adjust(scope.row)">调整余额</el-button>
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
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, yuan } from '../api';

const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const query = reactive({ keyword: '', role: '', page: 1, pageSize: 10 });

async function load() {
  const data = await api.users({ ...query });
  rows.value = data.list;
  total.value = data.total;
}

function onPage(page: number) {
  query.page = page;
  load();
}

async function toggle(row: Record<string, any>) {
  await api.updateUser(row.id, { status: row.status === 1 ? 0 : 1 });
  ElMessage.success('已更新');
  await load();
}

async function adjust(row: Record<string, any>) {
  const result = await ElMessageBox.prompt('输入调整金额（元，可为负）', '调整余额', { inputValue: '10' });
  const amountCents = Math.round(Number(result.value) * 100);
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    ElMessage.warning('金额不合法');
    return;
  }
  await api.adjustBalance(row.id, amountCents, '管理员调整');
  ElMessage.success('已调整');
  await load();
}

onMounted(load);
</script>
