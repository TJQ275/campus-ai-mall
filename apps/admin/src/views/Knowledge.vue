<template>
  <div>
    <h3 class="page-title">AI 知识库</h3>
    <p class="muted">客服助手回答政策问题的检索源。新增或修改后立刻生效：配置了 embedding 模型会同步补向量，否则走关键词检索。</p>

    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="搜索标题或内容" style="width: 240px" clearable @keyup.enter="load" />
      <el-select v-model="query.scene" placeholder="全部场景" clearable style="width: 160px">
        <el-option label="客服 support" value="support" />
        <el-option label="导购 shopping" value="shopping" />
        <el-option label="商家 merchant" value="merchant" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <el-button @click="openCreate">新增条款</el-button>
      <el-button @click="reindex">重建向量索引</el-button>
    </div>

    <el-table :data="rows" size="small">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="title" label="标题" width="180" />
      <el-table-column prop="scene" label="场景" width="110" />
      <el-table-column prop="source" label="来源" width="180" />
      <el-table-column prop="content" label="内容" min-width="320" show-overflow-tooltip />
      <el-table-column label="操作" width="140">
        <template #default="scope">
          <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="form.id ? '编辑条款' : '新增条款'" width="620px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="场景">
          <el-select v-model="form.scene">
            <el-option label="客服 support" value="support" />
            <el-option label="导购 shopping" value="shopping" />
            <el-option label="商家 merchant" value="merchant" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源"><el-input v-model="form.source" placeholder="policy/refund.md#1" /></el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="6" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const rows = ref<Record<string, any>[]>([]);
const dialog = ref(false);
const query = reactive({ keyword: '', scene: '', page: 1, pageSize: 50 });
const form = reactive({ id: 0, title: '', scene: 'support', source: '', content: '' });

async function load() {
  const data = await api.knowledgeList({ ...query });
  rows.value = data.list;
}

function openCreate() {
  Object.assign(form, { id: 0, title: '', scene: 'support', source: '', content: '' });
  dialog.value = true;
}

function openEdit(row: Record<string, any>) {
  Object.assign(form, { id: row.id, title: row.title, scene: row.scene, source: row.source, content: row.content });
  dialog.value = true;
}

async function save() {
  if (form.id) await api.knowledgeUpdate(form.id, { ...form });
  else await api.knowledgeCreate({ title: form.title, scene: form.scene, source: form.source, content: form.content });
  ElMessage.success('已保存');
  dialog.value = false;
  await load();
}

async function remove(row: Record<string, any>) {
  await ElMessageBox.confirm('确定删除「' + row.title + '」？', '提示', { type: 'warning' });
  await api.knowledgeRemove(row.id);
  ElMessage.success('已删除');
  await load();
}

async function reindex() {
  const result = await api.reindex();
  ElMessage.success('重建完成：' + JSON.stringify(result));
}

onMounted(load);
</script>
