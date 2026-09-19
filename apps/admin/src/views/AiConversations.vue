<template>
  <div>
    <h3 class="page-title">AI 会话回放</h3>
    <p class="muted">按会话查看完整对话、每一步工具调用与写操作确认记录 —— 这是「AI 真的在干活」最直接的证据。</p>

    <el-table :data="rows" size="small" @row-click="openReplay" style="cursor: pointer">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="title" label="开场白" min-width="220" />
      <el-table-column prop="nickname" label="用户" width="120" />
      <el-table-column prop="scene" label="场景" width="110" />
      <el-table-column prop="messageCount" label="消息数" width="90" />
      <el-table-column prop="lastMessageAt" label="最后活跃" min-width="180" />
    </el-table>

    <el-pagination
      style="margin-top: 16px"
      layout="prev, pager, next, total"
      :total="total"
      :page-size="query.pageSize"
      :current-page="query.page"
      @current-change="onPage"
    />

    <el-drawer v-model="drawer" size="60%" :title="'会话回放 #' + detail.conversation?.id">
      <el-descriptions :column="3" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="用户">{{ detail.conversation?.userId }}</el-descriptions-item>
        <el-descriptions-item label="场景">{{ detail.conversation?.scene }}</el-descriptions-item>
        <el-descriptions-item label="消息数">{{ detail.conversation?.messageCount }}</el-descriptions-item>
      </el-descriptions>

      <h4>对话与工具调用</h4>
      <el-timeline>
        <el-timeline-item
          v-for="item in timeline"
          :key="item.key"
          :timestamp="item.time"
          :type="item.kind === 'tool' ? 'warning' : item.kind === 'user' ? 'primary' : 'success'"
        >
          <div>{{ item.title }}</div>
          <div v-if="item.body" class="json-box" style="margin-top: 6px">{{ item.body }}</div>
        </el-timeline-item>
      </el-timeline>

      <h4 v-if="detail.pendingActions?.length">写操作确认记录</h4>
      <el-table v-if="detail.pendingActions?.length" :data="detail.pendingActions" size="small">
        <el-table-column prop="actionType" label="动作" width="160" />
        <el-table-column prop="summary" label="内容" min-width="220" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column prop="resultMessage" label="结果" min-width="160" />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';

const route = useRoute();
const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const drawer = ref(false);
const detail = ref<Record<string, any>>({ conversation: null, messages: [], toolCalls: [], pendingActions: [] });
const query = reactive({ page: 1, pageSize: 20 });

const timeline = computed(() => {
  const items: Record<string, any>[] = [];
  for (const m of detail.value.messages || []) {
    if (m.role === 'user') items.push({ key: 'm' + m.id, kind: 'user', time: m.createdAt, title: '用户：' + (m.content || '') });
    else if (m.role === 'assistant' && m.contentType === 'tool_calls') continue;
    else if (m.role === 'assistant') items.push({ key: 'm' + m.id, kind: 'assistant', time: m.createdAt, title: 'AI：' + (m.content || '') });
    else if (m.role === 'tool') items.push({ key: 'm' + m.id, kind: 'tool', time: m.createdAt, title: '工具 ' + (m.toolName || '') + ' 返回', body: m.content });
  }
  return items;
});

async function load() {
  const data = await api.conversations({ ...query });
  rows.value = data.list;
  total.value = data.total;
}

async function openReplay(row: Record<string, any>) {
  detail.value = (await api.conversationDetail(row.id)) as any;
  drawer.value = true;
}

function onPage(page: number) {
  query.page = page;
  load();
}

onMounted(async () => {
  await load();
  const id = Number(route.query.id || 0);
  if (id && rows.value.length) {
    const hit = rows.value.find((r) => r.id === id);
    if (hit) await openReplay(hit);
  }
});
</script>
