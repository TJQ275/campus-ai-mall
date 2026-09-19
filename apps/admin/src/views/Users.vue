<template>
  <div>
    <h3 class="page-title">用户管理</h3>
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="昵称 / openid / 手机号" style="width: 240px" clearable @keyup.enter="search" />
      <el-select v-model="query.role" placeholder="全部角色" clearable style="width: 150px" @change="search">
        <el-option label="普通用户" value="user" />
        <el-option label="管理员" value="admin" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <el-table :data="rows" size="small" v-loading="loading">
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
import { onMounted } from 'vue';
import { api, yuan } from '../api';
import { confirmAction, reportError, runAction } from '../composables/async';
import { useTable } from '../composables/useTable';

const { rows, total, loading, query, load, search, onPage } = useTable(
  (q, signal) => api.users(q, signal),
  { keyword: '', role: '', page: 1, pageSize: 10 },
);

async function toggle(row: Record<string, any>) {
  const disable = row.status === 1;
  const message = (disable ? '禁用' : '启用') + '用户「' + row.nickname + '」？' + (disable ? '禁用后该用户无法登录小程序。' : '');
  if (!(await confirmAction(message))) return;
  await runAction(async () => {
    await api.updateUser(row.id, { status: disable ? 0 : 1 });
    ElMessage.success('已更新');
    await load();
  }, '更新失败');
}

async function adjust(row: Record<string, any>) {
  let amountCents;
  try {
    // 第一步只收金额：这里校验完，下一步才能把「多少分」明确摆给操作员看
    const input = await ElMessageBox.prompt('输入调整金额（元，可为负）。当前余额 ' + yuan(row.balanceCents), '调整余额', {
      inputValue: '10',
      confirmButtonText: '下一步',
      cancelButtonText: '取消',
      inputValidator: (value: string) => {
        const amount = Number(value);
        if (!value || !Number.isFinite(amount)) return '请输入数字';
        if (Math.abs(amount) > 10000) return '单次调整不能超过 10000 元';
        if (Math.round(amount * 100) === 0) return '金额不能为 0';
        return true;
      },
    });
    amountCents = Math.round(Number(input.value) * 100);
  } catch {
    return; // 点了取消，正常操作
  }

  const signed = (amountCents > 0 ? '+' : '-') + yuan(Math.abs(amountCents));
  try {
    const remark = await ElMessageBox.prompt('本次调整 ' + signed + '（' + amountCents + ' 分），请填写备注', '调整余额', {
      inputPlaceholder: '例如：活动补偿',
      inputValidator: (value: string) => (value && value.trim().length > 0 ? true : '备注不能为空'),
    });
    await api.adjustBalance(row.id, amountCents, remark.value.trim());
    ElMessage.success('已调整');
    await load();
  } catch (error) {
    reportError(error, '余额调整失败');
  }
}

onMounted(load);
</script>
