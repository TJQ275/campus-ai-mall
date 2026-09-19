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

  /** 是否具备识图能力（需要单独的视觉模型） */
  get visionEnabled(): boolean {
    return Boolean(process.env.LLM_VISION_MODEL) && !this.provider.isMock;
  }

  /**
   * 用视觉模型把图片转成结构化描述。
   * 这是「拍照找同款」的第一步：图 → 文本标签 → 文本向量 / 关键词检索商品。
   * 没有视觉模型时返回 null，由调用方降级为「让用户描述或扫码」。
   */
  async describeImage(imageUrl: string): Promise<{ title: string; keywords: string[]; raw: string } | null> {
    if (!this.visionEnabled) return null;
    const baseUrl = (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/+$/, '');
    const absolute = imageUrl.startsWith('http') ? imageUrl : (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3100') + imageUrl;
    try {
      const response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.LLM_API_KEY ?? '') },
        body: JSON.stringify({
          model: process.env.LLM_VISION_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '这是校园商城里的一件商品（零食或二手教材）。用 JSON 回答：{"title":"品类名","keywords":["最多5个可用于检索的关键词，例如 辣条/薯片/高等数学/考研"]}。只输出 JSON。' },
                { type: 'image_url', image_url: { url: absolute } },
              ],
            },
          ],
        }),
      });
      if (!response.ok) throw new Error('视觉模型返回 ' + response.status);
      const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content ?? '';
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const parsed = JSON.parse(text.slice(start, end + 1)) as { title?: string; keywords?: string[] };
      return { title: String(parsed.title ?? ''), keywords: (parsed.keywords ?? []).map(String), raw: text };
    } catch (error) {
      this.logger.warn('识图失败: ' + (error as Error).message);
      return null;
    }
  }
}