<template>
  <div>
    <h3 class="page-title">AI 调用日志</h3>
    <p class="muted">每一次工具调用都记在 ai_tool_call 表里：模型调了什么、参数是什么、耗时多久、成功与否 —— 点开可看完整入参与返回。</p>

    <div class="toolbar">
      <el-select v-model="query.toolName" placeholder="全部工具" clearable style="width: 200px" @change="load">
        <el-option v-for="t in toolNames" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px" @change="load">
        <el-option label="成功" value="ok" />
        <el-option label="失败" value="error" />
        <el-option label="待确认" value="pending" />
      </el-select>
      <el-button @click="load">刷新</el-button>
      <span class="muted">共 {{ total }} 条</span>
    </div>

    <el-table :data="rows" size="small" @row-click="openDetail" style="cursor: pointer">
      <el-table-column type="expand">
        <template #default="scope">
          <div style="padding: 8px 0">
            <div class="muted">入参</div>
            <div class="json-box">{{ pretty(scope.row.args) }}</div>
            <div class="muted" style="margin-top: 8px">返回</div>
            <div class="json-box">{{ pretty(scope.row.result) }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="toolName" label="工具" width="200" />
      <el-table-column prop="nickname" label="用户" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="scope">
          <el-tag size="small" :type="scope.row.status === 'ok' ? 'success' : scope.row.status === 'pending' ? 'warning' : 'danger'">
            {{ scope.row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="durationMs" label="耗时" width="100">
        <template #default="scope">{{ scope.row.durationMs }} ms</template>
      </el-table-column>
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
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const toolNames = ref<string[]>([]);
const query = reactive({ toolName: '', status: '', page: 1, pageSize: 20 });

function pretty(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function load() {
  const data = await api.toolCalls({ ...query });
  rows.value = data.list;
  total.value = data.total;
}

function onPage(page: number) {
  query.page = page;
  load();
}

function openDetail(row: Record<string, any>) {
  if (row.conversationId) router.push('/ai/conversations?id=' + row.conversationId);
}

onMounted(async () => {
  const stats = await api.aiStats(30);
  toolNames.value = stats.byTool.map((t) => t.toolName);
  await load();
});
</script>
