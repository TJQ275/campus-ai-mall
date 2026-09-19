<template>
  <div>
    <h3 class="page-title">商品管理</h3>

    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="商品名 / ISBN" style="width: 220px" clearable @keyup.enter="load" />
      <el-select v-model="query.kind" placeholder="全部品类" clearable style="width: 150px">
        <el-option label="零食" value="snack" />
        <el-option label="二手书" value="book" />
      </el-select>
      <el-button type="primary" @click="load">查询</el-button>
    </div>

    <el-table :data="rows" size="small">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="title" label="商品" min-width="220" />
      <el-table-column label="品类" width="90">
        <template #default="scope"><el-tag size="small">{{ scope.row.kind === 'book' ? '二手书' : '零食' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="价格" width="100">
        <template #default="scope">{{ yuan(scope.row.priceCents) }}</template>
      </el-table-column>
      <el-table-column prop="stock" label="库存" width="80" />
      <el-table-column prop="sales" label="销量" width="80" />
      <el-table-column prop="viewCount" label="浏览" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="scope">
          <el-tag size="small" :type="scope.row.status === 'on' ? 'success' : 'info'">{{ scope.row.status === 'on' ? '在售' : '下架' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220">
        <template #default="scope">
          <el-button link type="primary" @click="toggle(scope.row)">{{ scope.row.status === 'on' ? '下架' : '上架' }}</el-button>
          <el-button link type="success" @click="writeCopy(scope.row)">AI 写文案</el-button>
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

    <el-dialog v-model="copyDialog" title="AI 生成商品文案" width="660px">
      <div class="toolbar">
        <el-select v-model="style" style="width: 180px">
          <el-option label="学生口语" value="student" />
          <el-option label="正式" value="professional" />
          <el-option label="活泼" value="playful" />
        </el-select>
        <el-button type="primary" :loading="generating" @click="generate">重新生成</el-button>
        <el-tag size="small" :type="copy.model === 'template' ? 'info' : 'success'">{{ copy.model === 'template' ? '模板生成' : copy.model }}</el-tag>
      </div>
      <template v-if="copy.title">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="标题">{{ copy.title }}</el-descriptions-item>
          <el-descriptions-item label="副标题">{{ copy.subtitle }}</el-descriptions-item>
          <el-descriptions-item label="卖点">
            <el-tag v-for="p in copy.sellingPoints" :key="p" size="small" style="margin-right: 6px">{{ p }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="详情">{{ copy.description }}</el-descriptions-item>
          <el-descriptions-item label="标签">
            <el-tag v-for="t in copy.tags" :key="t" size="small" type="success" style="margin-right: 6px">{{ t }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, yuan } from '../api';

const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const query = reactive({ keyword: '', kind: '', page: 1, pageSize: 10 });
const copyDialog = ref(false);
const generating = ref(false);
const style = ref('student');
const currentId = ref(0);
const copy = ref<Record<string, any>>({ sellingPoints: [], tags: [] });

async function load() {
  const data = await api.products({ ...query });
  rows.value = data.list;
  total.value = data.total;
}

function onPage(page: number) {
  query.page = page;
  load();
}

async function toggle(row: Record<string, any>) {
  await api.productStatus(row.id, row.status === 'on' ? 'off' : 'on');
  ElMessage.success('已更新');
  await load();
}

async function writeCopy(row: Record<string, any>) {
  currentId.value = row.id;
  copy.value = { sellingPoints: [], tags: [] };
  copyDialog.value = true;
  await generate();
}

async function generate() {
  generating.value = true;
  try {
    copy.value = (await api.copywriting(currentId.value, style.value)) as any;
  } finally {
    generating.value = false;
  }
}

onMounted(load);
</script>
