<template>
  <div>
    <h3 class="page-title">登录记录</h3>
    <p class="muted">
      谁在什么时候、用什么账号登录，成功还是失败。排查「用户表里怎么没这个人」「是不是有人在试密码」看这里。
    </p>

    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="账号 / openid" style="width: 240px" clearable @keyup.enter="search" />
      <el-select v-model="query.result" placeholder="全部结果" clearable style="width: 140px" @change="search">
        <el-option label="成功" value="ok" />
        <el-option label="失败" value="fail" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <el-table :data="rows" size="small" v-loading="loading">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="username" label="登录账号" min-width="200" show-overflow-tooltip />
      <el-table-column label="结果" width="90">
        <template #default="scope">
          <el-tag size="small" :type="scope.row.success ? 'success' : 'danger'">
            {{ scope.row.success ? '成功' : '失败' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="说明" min-width="140" />
      <el-table-column label="用户" width="90">
        <template #default="scope">
          <span v-if="scope.row.userId">#{{ scope.row.userId }}</span>
          <span v-else class="muted">未建号</span>
        </template>
      </el-table-column>
      <el-table-column prop="ip" label="来源 IP" width="150" />
      <el-table-column prop="createdAt" label="时间" min-width="180" />
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
import { api } from '../api';
import { useTable } from '../composables/useTable';

const { rows, total, loading, query, load, search, onPage } = useTable(
  (q, signal) => api.loginLogs(q, signal),
  { keyword: '', result: '', page: 1, pageSize: 20 },
);

onMounted(load);
</script>
