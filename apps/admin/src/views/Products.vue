<template>
  <div>
    <h3 class="page-title">商品管理</h3>

    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="商品名 / ISBN" style="width: 220px" clearable @keyup.enter="search" />
      <el-select v-model="query.kind" placeholder="全部品类" clearable style="width: 150px" @change="search">
        <el-option label="零食" value="snack" />
        <el-option label="二手书" value="book" />
      </el-select>
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 130px" @change="search">
        <el-option label="在售" value="on" />
        <el-option label="已下架" value="off" />
        <el-option label="草稿" value="draft" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button type="success" @click="openCreate">新增商品</el-button>
    </div>

    <el-table :data="rows" size="small" v-loading="loading">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="图片" width="70">
        <template #default="scope">
          <el-image
            v-if="scope.row.cover"
            :src="scope.row.cover"
            fit="cover"
            style="width: 40px; height: 40px; border-radius: 4px"
            :preview-src-list="[scope.row.cover]"
            preview-teleported
          />
          <span v-else class="muted">无图</span>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="商品" min-width="220" show-overflow-tooltip />
      <el-table-column label="品类" width="90">
        <template #default="scope"><el-tag size="small">{{ PRODUCT_KIND_LABEL[scope.row.kind as 'snack' | 'book'] ?? scope.row.kind }}</el-tag></template>
      </el-table-column>
      <el-table-column label="价格" width="100">
        <template #default="scope">{{ yuan(scope.row.priceCents) }}</template>
      </el-table-column>
      <el-table-column prop="stock" label="库存" width="80" />
      <el-table-column prop="sales" label="销量" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="scope">
          <el-tag size="small" :type="scope.row.status === 'on' ? 'success' : 'info'">
            {{ scope.row.status === 'on' ? '在售' : scope.row.status === 'draft' ? '草稿' : '已下架' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250">
        <template #default="scope">
          <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
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

    <!-- 新增 / 编辑商品 -->
    <el-dialog v-model="dialog" :title="form.id ? '编辑商品 #' + form.id : '新增商品'" width="760px" top="6vh">
      <el-form :model="form" label-width="100px">
        <el-form-item label="品类" required>
          <el-radio-group v-model="form.kind" @change="onKindChange">
            <el-radio-button value="snack">零食</el-radio-button>
            <el-radio-button value="book">二手书</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="商品标题" required>
          <el-input v-model="form.title" maxlength="120" show-word-limit placeholder="例如：卫龙大面筋辣条 106g" />
        </el-form-item>

        <el-form-item label="副标题">
          <el-input v-model="form.subtitle" maxlength="200" placeholder="一句话卖点，会显示在商品卡片上" />
        </el-form-item>

        <el-form-item label="商品图片">
          <div class="cover-upload">
            <el-image v-if="form.cover" :src="form.cover" fit="cover" class="cover-preview" />
            <el-upload
              :show-file-list="false"
              :auto-upload="false"
              accept="image/png,image/jpeg,image/webp,image/gif"
              :on-change="onPickImage"
            >
              <el-button :loading="uploading">{{ form.cover ? '更换图片' : '上传图片' }}</el-button>
            </el-upload>
            <el-button v-if="form.cover" link type="danger" @click="form.cover = ''">移除</el-button>
          </div>
          <div class="muted" style="margin-top: 4px">支持 png / jpg / webp / gif，会自动压缩到 1200px 以内再上传</div>
        </el-form-item>

        <el-form-item label="所属分类" required>
          <el-select v-model="form.categoryId" placeholder="请选择分类" style="width: 260px">
            <el-option v-for="item in categoryOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <span v-if="!categoryOptions.length" class="muted" style="margin-left: 8px">
            该品类下还没有分类，请先到「AI 知识库 > 分类」或直接改 seed 数据
          </span>
        </el-form-item>

        <el-form-item label="售价（元）" required>
          <el-input-number v-model="priceYuan" :min="0" :precision="2" :step="1" />
          <span class="muted" style="margin-left: 8px">存库会换算成「分」</span>
        </el-form-item>

        <el-form-item label="原价（元）">
          <el-input-number v-model="originalPriceYuan" :min="0" :precision="2" :step="1" />
          <span class="muted" style="margin-left: 8px">留 0 表示不显示划线价</span>
        </el-form-item>

        <el-form-item label="库存">
          <el-input-number v-model="form.stock" :min="0" :max="1000000" />
        </el-form-item>

        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button value="on">上架在售</el-radio-button>
            <el-radio-button value="off">下架</el-radio-button>
            <el-radio-button value="draft">草稿</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="标签">
          <el-input
            v-model="tagInput"
            style="width: 260px"
            placeholder="输入后回车，如：辣、宿舍必备"
            @keyup.enter="addTag"
          />
          <el-button style="margin-left: 8px" @click="addTag">添加</el-button>
          <div style="margin-top: 8px">
            <el-tag v-for="tag in form.tags" :key="tag" closable size="small" style="margin-right: 6px" @close="form.tags = form.tags.filter((t) => t !== tag)">
              {{ tag }}
            </el-tag>
          </div>
          <div class="muted" style="margin-top: 4px">标签是 AI 导购的关键词来源（用户说「想吃辣的」就是靠标签命中）</div>
        </el-form-item>

        <!-- 零食属性 -->
        <template v-if="form.kind === 'snack'">
          <el-form-item label="口味"><el-input v-model="form.flavor" style="width: 260px" placeholder="如：香辣、番茄" /></el-form-item>
          <el-form-item label="辣度">
            <el-rate v-model="form.spicyLevel" :max="5" allow-half />
            <span class="muted" style="margin-left: 8px">0 表示不辣</span>
          </el-form-item>
          <el-form-item label="规格"><el-input v-model="form.spec" style="width: 260px" placeholder="如：106g / 桶" /></el-form-item>
          <el-form-item label="保质期">
            <el-input-number v-model="form.shelfLifeDays" :min="0" :max="3650" />
            <span class="muted" style="margin-left: 8px">天</span>
          </el-form-item>
        </template>

        <!-- 二手书属性 -->
        <template v-else>
          <el-form-item label="ISBN"><el-input v-model="form.isbn" style="width: 260px" placeholder="13 位，扫码找书靠它精确匹配" /></el-form-item>
          <el-form-item label="作者"><el-input v-model="form.author" style="width: 260px" /></el-form-item>
          <el-form-item label="出版社"><el-input v-model="form.publisher" style="width: 260px" /></el-form-item>
          <el-form-item label="版次"><el-input v-model="form.edition" style="width: 260px" placeholder="如：第 7 版" /></el-form-item>
          <el-form-item label="适用课程"><el-input v-model="form.course" style="width: 260px" placeholder="如：高等数学（上）" /></el-form-item>
          <el-form-item label="成色">
            <el-select v-model="form.condition" style="width: 160px" clearable>
              <el-option v-for="(label, value) in BOOK_CONDITION_LABEL" :key="value" :label="label" :value="value" />
            </el-select>
          </el-form-item>
          <el-form-item label="有笔记">
            <el-switch v-model="form.hasNotes" />
          </el-form-item>
        </template>

        <el-form-item label="商品详情">
          <el-input v-model="form.description" type="textarea" :rows="4" maxlength="5000" show-word-limit />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- AI 文案：生成后可以一键填回表单 -->
    <el-dialog v-model="copyDialog" title="AI 生成商品文案" width="660px">
      <div class="toolbar">
        <el-select v-model="style" style="width: 180px">
          <el-option label="学生口语" value="student" />
          <el-option label="正式" value="professional" />
          <el-option label="活泼" value="playful" />
        </el-select>
        <el-button type="primary" :loading="generating" @click="generate">重新生成</el-button>
        <el-tag size="small" :type="copy.model === 'template' ? 'info' : 'success'">
          {{ copy.model === 'template' ? '模板生成' : copy.model }}
        </el-tag>
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
      <template #footer>
        <el-button @click="copyDialog = false">关闭</el-button>
        <el-button type="primary" @click="applyCopy">把文案填回商品表单</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { UploadFile } from 'element-plus';
import { BOOK_CONDITION_LABEL, PRODUCT_KIND_LABEL } from '@campus/shared';
import { api, yuan } from '../api';
import { runAction } from '../composables/async';
import { useTable } from '../composables/useTable';

const { rows, total, loading, query, load, search, onPage } = useTable<Record<string, any>, { keyword: string; kind: string; status: string; page: number; pageSize: number }>(
  (q, signal) => api.products(q, signal),
  { keyword: '', kind: '', status: '', page: 1, pageSize: 10 },
);

// ── 商品表单 ──
interface ProductForm {
  id: number;
  kind: 'snack' | 'book';
  title: string;
  subtitle: string;
  cover: string;
  categoryId: number | undefined;
  priceCents: number;
  originalPriceCents: number;
  stock: number;
  status: 'on' | 'off' | 'draft';
  tags: string[];
  description: string;
  // 零食
  flavor: string;
  spicyLevel: number;
  spec: string;
  shelfLifeDays: number | undefined;
  // 二手书
  isbn: string;
  author: string;
  publisher: string;
  edition: string;
  course: string;
  condition: string;
  hasNotes: boolean;
}

const emptyForm = (): ProductForm => ({
  id: 0, kind: 'snack', title: '', subtitle: '', cover: '', categoryId: undefined,
  priceCents: 0, originalPriceCents: 0, stock: 0, status: 'on', tags: [], description: '',
  flavor: '', spicyLevel: 0, spec: '', shelfLifeDays: undefined,
  isbn: '', author: '', publisher: '', edition: '', course: '', condition: '', hasNotes: false,
});

const dialog = ref(false);
const saving = ref(false);
const uploading = ref(false);
const tagInput = ref('');
const form = reactive<ProductForm>(emptyForm());
const categoryList = ref<{ id: number; name: string; kind: string }[]>([]);

const categoryOptions = computed(() => categoryList.value.filter((c) => c.kind === form.kind));
const priceYuan = computed({
  get: () => form.priceCents / 100,
  set: (value: number) => { form.priceCents = Math.round((value ?? 0) * 100); },
});
const originalPriceYuan = computed({
  get: () => form.originalPriceCents / 100,
  set: (value: number) => { form.originalPriceCents = Math.round((value ?? 0) * 100); },
});

function onKindChange() {
  form.categoryId = undefined;
}

function addTag() {
  const tag = tagInput.value.trim();
  if (!tag) return;
  if (!form.tags.includes(tag) && form.tags.length < 12) form.tags.push(tag);
  tagInput.value = '';
}

async function openCreate() {
  Object.assign(form, emptyForm());
  // 新增时沿用当前筛选的品类，少点一次
  if (query.kind === 'snack' || query.kind === 'book') form.kind = query.kind;
  dialog.value = true;
}

function openEdit(row: Record<string, any>) {
  Object.assign(form, emptyForm(), {
    id: row.id,
    kind: row.kind === 'book' ? 'book' : 'snack',
    title: row.title ?? '',
    subtitle: row.subtitle ?? '',
    cover: row.cover ?? '',
    categoryId: row.categoryId,
    priceCents: row.priceCents ?? 0,
    originalPriceCents: row.originalPriceCents ?? 0,
    stock: row.stock ?? 0,
    status: row.status ?? 'on',
    tags: Array.isArray(row.tags) ? [...row.tags] : [],
    description: row.description ?? '',
    flavor: row.flavor ?? '',
    spicyLevel: row.spicyLevel ?? 0,
    spec: row.spec ?? '',
    shelfLifeDays: row.shelfLifeDays ?? undefined,
    isbn: row.isbn ?? '',
    author: row.author ?? '',
    publisher: row.publisher ?? '',
    edition: row.edition ?? '',
    course: row.course ?? '',
    condition: row.condition ?? '',
    hasNotes: Boolean(row.hasNotes),
  });
  dialog.value = true;
}

/**
 * 图片上传：先在前端压缩再传。
 * 手机拍的照片动辄 3-5MB，base64 之后还要再大 1/3，很容易超过后端 5MB 的限制 ——
 * 缩到 1200px 以内、JPEG 0.85 之后通常只有一两百 KB。
 */
function pickImage(file: UploadFile): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('图片解析失败'));
      image.onload = () => {
        const max = 1200;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(String(reader.result)); return; }
        // 铺白底：PNG 透明区域转 JPEG 后不会变成黑块
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file.raw as File);
  });
}

async function onPickImage(file: UploadFile) {
  uploading.value = true;
  try {
    const dataUrl = await pickImage(file);
    const result = await api.upload(dataUrl);
    form.cover = result.url;
    ElMessage.success('图片已上传');
  } catch (error) {
    ElMessage.error((error as Error).message || '图片上传失败');
  } finally {
    uploading.value = false;
  }
}

async function save() {
  if (!form.title.trim()) { ElMessage.warning('请填写商品标题'); return; }
  if (!form.categoryId) { ElMessage.warning('请选择商品分类'); return; }
  if (form.priceCents <= 0) { ElMessage.warning('请填写售价'); return; }

  saving.value = true;
  try {
    const payload: Record<string, unknown> = {
      kind: form.kind,
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || undefined,
      description: form.description.trim() || undefined,
      cover: form.cover || undefined,
      categoryId: form.categoryId,
      priceCents: form.priceCents,
      originalPriceCents: form.originalPriceCents || undefined,
      stock: form.stock,
      status: form.status,
      tags: form.tags,
    };
    if (form.id) payload.id = form.id;
    if (form.kind === 'snack') {
      Object.assign(payload, {
        flavor: form.flavor || undefined,
        spicyLevel: form.spicyLevel || undefined,
        spec: form.spec || undefined,
        shelfLifeDays: form.shelfLifeDays ?? undefined,
      });
    } else {
      Object.assign(payload, {
        isbn: form.isbn || undefined,
        author: form.author || undefined,
        publisher: form.publisher || undefined,
        edition: form.edition || undefined,
        course: form.course || undefined,
        condition: form.condition || undefined,
        hasNotes: form.hasNotes,
      });
    }
    await api.productSave(payload);
    ElMessage.success(form.id ? '已保存' : '商品已创建');
    dialog.value = false;
    await load();
  } catch {
    // http 层已提示
  } finally {
    saving.value = false;
  }
}

async function toggle(row: Record<string, any>) {
  await runAction(async () => {
    await api.productStatus(row.id, row.status === 'on' ? 'off' : 'on');
    ElMessage.success(row.status === 'on' ? '已下架' : '已上架');
    await load();
  }, '操作失败');
}

// ── AI 文案 ──
const copyDialog = ref(false);
const generating = ref(false);
const style = ref('student');
const currentId = ref(0);
const copy = ref<Record<string, any>>({ sellingPoints: [], tags: [] });

function writeCopy(row: Record<string, any>) {
  currentId.value = row.id;
  copy.value = { sellingPoints: [], tags: [] };
  copyDialog.value = true;
  void generate();
}

async function generate() {
  generating.value = true;
  try {
    copy.value = (await api.copywriting(currentId.value, style.value)) as unknown as Record<string, any>;
  } catch {
    // http 层已提示
  } finally {
    generating.value = false;
  }
}

/** 把生成结果填回表单（编辑同一个商品时），省掉手动复制粘贴 */
function applyCopy() {
  if (!copy.value.title) return;
  form.title = copy.value.title;
  form.subtitle = copy.value.subtitle ?? form.subtitle;
  form.description = copy.value.description ?? form.description;
  if (Array.isArray(copy.value.tags) && copy.value.tags.length) form.tags = copy.value.tags.slice(0, 12);
  copyDialog.value = false;
  dialog.value = true;
  ElMessage.success('已填回表单，确认后点保存');
}

onMounted(async () => {
  await runAction(async () => {
    categoryList.value = (await api.categories()) as unknown as { id: number; name: string; kind: string }[];
  }, '分类加载失败');
  await load();
});
</script>

<style scoped>
.cover-upload {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cover-preview {
  width: 88px;
  height: 88px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
}
</style>
