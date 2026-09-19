import { Injectable, Logger } from '@nestjs/common';
import { MockProvider } from './provider/mock.provider.js';
import { OpenAiCompatibleProvider } from './provider/openai-compatible.provider.js';
import type { LlmProvider } from './provider/types.js';

/**
 * 模型选择的唯一入口。
 * 配置了 LLM_API_KEY 就走真实模型，否则自动使用 MockProvider —— 这是「无 Key 也能演示」的开关。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly provider: LlmProvider;

  constructor() {
    const apiKey = process.env.LLM_API_KEY?.trim();
    if (apiKey) {
      this.provider = new OpenAiCompatibleProvider({
        baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
        apiKey,
        model: process.env.LLM_MODEL ?? 'deepseek-chat',
        embeddingModel: process.env.LLM_EMBEDDING_MODEL,
        timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
      });
      this.logger.log('AI 使用真实模型: ' + this.provider.model);
    } else {
      this.provider = new MockProvider();
      this.logger.warn('未配置 LLM_API_KEY，AI 走 MockProvider 规则降级（功能完整，话术为模板）');
    }
  }

  get current(): LlmProvider {
    return this.provider;
  }

  /** 真实模型挂了时的兜底实例 */
  mock(): LlmProvider {
    return new MockProvider();
  }

  status() {
    return {
      provider: this.provider.name,
      model: this.provider.model,
      mock: this.provider.isMock,
      baseUrl: this.provider.isMock ? null : (process.env.LLM_BASE_URL ?? null),
      embedding: process.env.LLM_EMBEDDING_MODEL ? 'enabled' : 'disabled',
    };
  }
}
