import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { sysConfigs } from '../../db/schema/index.js';

/**
 * 大模型运行时配置。
 *
 * 优先级：数据库（管理后台「AI 设置」页保存）> .env > 代码默认值。
 * 这样不懂技术的买家可以直接在后台填 API Key，不用改文件、不用重启；
 * 开发者仍然可以用 .env 预置一套默认配置。
 */
export interface LlmRuntimeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
  embeddingModel: string;
  embeddingDim: number;
  timeoutMs: number;
}

/** 数据库里的键名 → 配置字段。前缀统一，方便一次性读出来 */
const DB_KEYS: Record<keyof LlmRuntimeConfig, string> = {
  baseUrl: 'llm.base_url',
  apiKey: 'llm.api_key',
  model: 'llm.model',
  visionModel: 'llm.vision_model',
  embeddingModel: 'llm.embedding_model',
  embeddingDim: 'llm.embedding_dim',
  timeoutMs: 'llm.timeout_ms',
};

const DEFAULTS: LlmRuntimeConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  visionModel: '',
  embeddingModel: '',
  embeddingDim: 1024,
  timeoutMs: 60000,
};

const fromEnv = (): LlmRuntimeConfig => ({
  baseUrl: process.env.LLM_BASE_URL?.trim() || DEFAULTS.baseUrl,
  apiKey: process.env.LLM_API_KEY?.trim() || '',
  model: process.env.LLM_MODEL?.trim() || DEFAULTS.model,
  visionModel: process.env.LLM_VISION_MODEL?.trim() || '',
  embeddingModel: process.env.LLM_EMBEDDING_MODEL?.trim() || '',
  embeddingDim: Number(process.env.LLM_EMBEDDING_DIM ?? DEFAULTS.embeddingDim) || DEFAULTS.embeddingDim,
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? DEFAULTS.timeoutMs) || DEFAULTS.timeoutMs,
});

@Injectable()
export class LlmConfigService {
  private readonly logger = new Logger(LlmConfigService.name);
  private snapshot: LlmRuntimeConfig = fromEnv();
  /** 哪些字段来自数据库（后台改过），用于前端提示与「恢复默认」 */
  private overridden = new Set<string>();

  constructor(@Inject(DB) private readonly db: Db) {}

  /** 启动时读一次数据库配置；读不到就用 .env（不让配置问题阻断启动） */
  async load(): Promise<void> {
    try {
      const keys = Object.values(DB_KEYS);
      const rows = await this.db.select().from(sysConfigs).where(inArray(sysConfigs.key, keys));
      const merged: LlmRuntimeConfig = { ...fromEnv() };
      const overridden = new Set<string>();
      for (const row of rows) {
        const field = (Object.keys(DB_KEYS) as (keyof LlmRuntimeConfig)[]).find((f) => DB_KEYS[f] === row.key);
        if (!field) continue;
        const value = (row.value ?? '').trim();
        if (!value) continue;
        if (field === 'embeddingDim' || field === 'timeoutMs') {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0) continue;
          merged[field] = Math.trunc(parsed);
        } else {
          merged[field] = value;
        }
        overridden.add(field);
      }
      this.snapshot = merged;
      this.overridden = overridden;
      this.logger.log('AI 配置已加载：' + (merged.apiKey ? '已配置 Key（' + merged.model + '）' : '未配置 Key，走降级模式'));
    } catch (error) {
      this.logger.warn('读取数据库 AI 配置失败，使用 .env 配置: ' + (error as Error).message);
    }
  }

  get current(): LlmRuntimeConfig {
    return this.snapshot;
  }

  /** 用于判断 provider 是否需要重建：配置变了就换实例 */
  get signature(): string {
    const c = this.snapshot;
    return [c.baseUrl, c.apiKey, c.model, c.visionModel, c.embeddingModel, c.embeddingDim, c.timeoutMs].join('|');
  }

  isOverridden(field: keyof LlmRuntimeConfig): boolean {
    return this.overridden.has(field);
  }

  /** 后台保存：写库后立刻刷新内存快照，无需重启 */
  async save(patch: Partial<LlmRuntimeConfig>): Promise<void> {
    const entries = (Object.keys(DB_KEYS) as (keyof LlmRuntimeConfig)[])
      .filter((field) => patch[field] !== undefined)
      .map((field) => ({ key: DB_KEYS[field], value: String(patch[field] ?? '') }));

    for (const entry of entries) {
      await this.db
        .insert(sysConfigs)
        .values({ key: entry.key, value: entry.value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: sysConfigs.key, set: { value: entry.value, updatedAt: new Date() } });
    }
    await this.load();
  }

  /** 恢复默认：删掉数据库里的覆盖项，回到 .env */
  async reset(fields?: (keyof LlmRuntimeConfig)[]): Promise<void> {
    const targets = (fields ?? (Object.keys(DB_KEYS) as (keyof LlmRuntimeConfig)[])).map((f) => DB_KEYS[f]);
    if (targets.length) {
      await this.db.delete(sysConfigs).where(inArray(sysConfigs.key, targets));
    }
    await this.load();
  }

  /** 给前端看的脱敏视图：Key 只回显前后各 4 位 */
  describe() {
    const c = this.snapshot;
    return {
      baseUrl: c.baseUrl,
      model: c.model,
      visionModel: c.visionModel,
      embeddingModel: c.embeddingModel,
      embeddingDim: c.embeddingDim,
      timeoutMs: c.timeoutMs,
      apiKeyConfigured: Boolean(c.apiKey),
      apiKeyMasked: c.apiKey ? c.apiKey.slice(0, 4) + '****' + c.apiKey.slice(-4) : '',
      overridden: Object.fromEntries(
        (Object.keys(DB_KEYS) as (keyof LlmRuntimeConfig)[]).map((f) => [f, this.overridden.has(f)]),
      ),
      /** 可选模型清单：卖家不知道填什么时给个下拉 */
      presets: LLM_PRESETS,
    };
  }
}

/** 常见 OpenAI 兼容服务预设，后台下拉直接用 */
export const LLM_PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: '', embeddingModel: '' },
  { label: '阿里云通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus', embeddingModel: 'text-embedding-v3' },
  { label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', visionModel: '', embeddingModel: '' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', visionModel: 'glm-4v-flash', embeddingModel: 'embedding-3' },
  { label: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', visionModel: '', embeddingModel: 'nomic-embed-text' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' },
];
