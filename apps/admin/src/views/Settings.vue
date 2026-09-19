<template>
  <div>
    <h3 class="page-title">AI 设置</h3>
    <p class="muted">
      在这里填你自己的大模型 API Key，保存后立即生效，不需要改 .env、不需要重启。
      留空也能跑：系统会自动降级为内置规则引擎，工具调用链路完全一致，只是话术变成模板。
    </p>

    <el-alert
      v-if="settings && settings.runtime.mock"
      type="warning"
      show-icon
      :closable="false"
      title="当前是「本地演示模式」"
      description="还没有可用的 API Key，AI 回复由内置规则引擎生成。填入 Key 并保存后会自动切换为真实模型。"
      style="margin-bottom: 16px"
    />
    <el-alert
      v-else-if="settings"
      type="success"
      show-icon
      :closable="false"
      :title="'当前使用真实模型：' + settings.runtime.model"
      :description="'接口地址 ' + (settings.runtime.baseUrl ?? '-') + '，配置来源：' + (settings.runtime.configSource === 'admin' ? '后台设置' : '.env 文件')"
      style="margin-bottom: 16px"
    />

    <el-card shadow="never" style="margin-bottom: 16px">
      <template #header><b>连接配置</b></template>
      <el-form :model="form" label-width="120px" style="max-width: 680px">
        <el-form-item label="服务商预设">
          <el-select v-model="preset" placeholder="选一家自动填好地址和模型名" clearable style="width: 260px" @change="applyPreset">
            <el-option v-for="item in settings?.presets ?? []" :key="item.label" :label="item.label" :value="item.label" />
          </el-select>
          <span class="muted" style="margin-left: 12px">也可以手动填下面的字段</span>
        </el-form-item>

        <el-form-item label="Base URL">
          <el-input v-model="form.baseUrl" placeholder="https://api.deepseek.com/v1" />
        </el-form-item>

        <el-form-item label="API Key">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="settings?.apiKeyConfigured ? '已配置（' + settings.apiKeyMasked + '），留空表示不修改' : 'sk-...'"
          />
          <div class="muted" style="line-height: 1.6; margin-top: 4px">
            留空 = 保持现有 Key 不变；填 <code>clear</code> 可以清空，清空后回到本地演示模式。
          </div>
        </el-form-item>

        <el-form-item label="对话模型">
          <el-input v-model="form.model" placeholder="deepseek-chat" />
          <div class="muted" style="margin-top: 4px">导购、客服、经营分析都用它，必填</div>
        </el-form-item>

        <el-form-item label="视觉模型">
          <el-input v-model="form.visionModel" placeholder="留空表示不支持「拍照找同款」" />
          <div class="muted" style="margin-top: 4px">可选。填了才能用拍照识图，例如 qwen-vl-plus / glm-4v-flash</div>
        </el-form-item>

        <el-form-item label="向量模型">
          <el-input v-model="form.embeddingModel" placeholder="留空表示检索走关键词" />
          <div class="muted" style="margin-top: 4px">
            可选。填了之后语义检索才生效，需要再跑一次 <code>pnpm ai:embed</code> 补向量。
          </div>
          <div v-if="form.embeddingModel" class="muted" style="color: var(--el-color-warning); margin-top: 4px">
            注意：向量维度和建表时一致才能用（当前 {{ settings?.embeddingDim ?? 1024 }} 维）。
            如果这里填的模型输出维度不同，系统会记录一条错误日志并自动退回关键词检索，不会影响下单等功能。
          </div>
        </el-form-item>

        <el-form-item label="超时（毫秒）">
          <el-input-number v-model="form.timeoutMs" :min="1000" :max="300000" :step="5000" />
        </el-form-item>

        <el-form-item>
          <el-button :loading="testing" @click="test">测试连接</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存并生效</el-button>
          <el-button @click="reset">恢复默认（.env）</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="testResult"
        :type="testResult.ok ? 'success' : 'error'"
        show-icon
        :closable="false"
        :title="testResult.ok ? '连接成功' : '连接失败'"
        :description="testResult.ok ? testResult.message + '（' + testResult.model + '，耗时 ' + testResult.latencyMs + 'ms）' : testResult.message"
      />
    </el-card>

    <el-card shadow="never">
      <template #header><b>怎么选一家大模型服务</b></template>
      <el-table :data="settings?.presets ?? []" size="small">
        <el-table-column prop="label" label="服务商" width="140" />
        <el-table-column prop="baseUrl" label="Base URL" min-width="260" />
        <el-table-column prop="model" label="推荐对话模型" width="180" />
        <el-table-column prop="visionModel" label="视觉模型" width="150" />
      </el-table>
      <p class="muted" style="margin-top: 12px; line-height: 1.8">
        以上服务都兼容 OpenAI 接口协议，任意一家都可以，选便宜的即可（DeepSeek、通义千问、智谱都有免费额度）。
        也可以填本地 Ollama 的地址（<code>http://localhost:11434/v1</code>），完全离线运行。
      </p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, type LlmSettings } from '../api';
import { confirmAction, runAction } from '../composables/async';

const settings = ref<LlmSettings | null>(null);
const preset = ref('');
const saving = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string; model?: string; latencyMs?: number } | null>(null);

const form = reactive({
  baseUrl: '',
  apiKey: '',
  model: '',
  visionModel: '',
  embeddingModel: '',
  timeoutMs: 60000,
});

function fill(data: LlmSettings) {
  settings.value = data;
  form.baseUrl = data.baseUrl;
  form.model = data.model;
  form.visionModel = data.visionModel;
  form.embeddingModel = data.embeddingModel;
  form.timeoutMs = data.timeoutMs;
  // Key 永远不回显，留空即「不修改」
  form.apiKey = '';
}

async function load() {
  await runAction(async () => {
    fill(await api.llmSettings());
  }, '读取 AI 配置失败');
}

function applyPreset(label: string) {
  const item = settings.value?.presets.find((p) => p.label === label);
  if (!item) return;
  form.baseUrl = item.baseUrl;
  form.model = item.model;
  form.visionModel = item.visionModel;
  form.embeddingModel = item.embeddingModel;
}

async function test() {
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await api.testLlm({
      baseUrl: form.baseUrl,
      model: form.model,
      // 页面上没填新 Key 就测已保存的那一份
      apiKey: form.apiKey || undefined,
    });
  } catch (error) {
    testResult.value = { ok: false, message: (error as Error).message || '测试失败' };
  } finally {
    testing.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    fill(
      await api.saveLlmSettings({
        baseUrl: form.baseUrl,
        model: form.model,
        visionModel: form.visionModel,
        embeddingModel: form.embeddingModel,
        timeoutMs: form.timeoutMs,
        // 留空不下发，避免把已保存的 Key 覆盖成空
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      }),
    );
    ElMessage.success('已保存，AI 已切换到新配置');
  } catch {
    // http 层已经提示过
  } finally {
    saving.value = false;
  }
}

async function reset() {
  // 必须说清楚 Key 会被**删掉且找不回来**：出于安全，保存后的 Key 永远不回显明文，
  // 删掉就只能去服务商后台重新申请。原来只写「回到 .env 默认值」，用户不知道代价。
  const tips = settings.value?.apiKeyConfigured
    ? '⚠ 已保存的 API Key 会被一并删除，且**无法找回**（出于安全，Key 保存后不会回显明文）。需要你到服务商后台重新获取并填写。确定继续吗？'
    : '确定清除后台保存的配置、回到 .env 里的默认值？';
  if (!(await confirmAction(tips))) return;
  await runAction(async () => {
    fill(await api.resetLlmSettings());
    ElMessage.success('已恢复默认');
  }, '恢复默认失败');
}

onMounted(load);
</script>
