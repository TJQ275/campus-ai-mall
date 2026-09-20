import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MockProvider } from './provider/mock.provider.js';
import { OpenAiCompatibleProvider } from './provider/openai-compatible.provider.js';
import type { LlmProvider } from './provider/types.js';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MockChatModel } from './langchain/mock-chat-model.js';
import { LlmConfigService, type LlmRuntimeConfig } from './llm-config.service.js';

/**
 * 模型选择的唯一入口。
 *
 * 配置来源是 LlmConfigService（数据库 > .env）：配了 API Key 就走真实模型，
 * 否则自动用 MockProvider —— 这是「无 Key 也能演示」的开关。
 * 后台改完配置会刷新快照，这里按 signature 惰性重建 provider，所以不用重启服务。
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private provider!: LlmProvider;
  private providerSignature = '';

  constructor(private readonly config: LlmConfigService) {
    this.provider = this.build(this.config.current);
  }

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  /**
   * 读取配置并装配 provider。
   * Nest 启动时由 onModuleInit 调用；独立脚本（ai:embed / demo:prepare）手动调用。
   */
  async init(): Promise<void> {
    await this.config.load();
    this.provider = this.build(this.config.current);
    if (this.provider.isMock) {
      this.logger.warn('未配置大模型 Key，AI 走 MockProvider 规则降级（功能完整，话术为模板）');
    } else {
      this.logger.log('AI 使用真实模型: ' + this.provider.model);
    }
  }

  private build(config: LlmRuntimeConfig): LlmProvider {
    this.providerSignature = this.config.signature;
    if (!config.apiKey) return new MockProvider();
    return new OpenAiCompatibleProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      embeddingModel: config.embeddingModel,
      timeoutMs: config.timeoutMs,
    });
  }

  get current(): LlmProvider {
    // 后台改过配置 → 下次取用时自动换实例
    if (this.config.signature !== this.providerSignature) {
      this.logger.log('AI 配置已变更，重建模型客户端');
      this.provider = this.build(this.config.current);
    }
    return this.provider;
  }

  /** 真实模型挂了时的兜底实例 */
  mock(): LlmProvider {
    return new MockProvider();
  }

  // ==================== LangChain 模型（Agent 走这条路径）====================

  /**
   * 给 LangChain 的 createAgent 用的模型实例。
   *
   * 有 Key 时是 ChatOpenAI（走 OpenAI 兼容协议，所以 DeepSeek / 通义 / 智谱 共用同一份代码）；
   * 没 Key 时是自定义的 MockChatModel —— 规则引擎被包成了 LangChain 认得的模型，
   * 上层 Agent 完全感知不到差别。这就是「无 Key 也能完整演示」在框架下的实现方式。
   */
  chatModel(options: { streaming?: boolean } = {}): BaseChatModel {
    const config = this.config.current;
    const provider = this.current;
    if (provider.isMock || !config.apiKey) return new MockChatModel();

    return new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      streaming: options.streaming ?? true,
      timeout: config.timeoutMs,
      // 关键：baseURL 指向服务商的 OpenAI 兼容端点，换厂商只改配置、不改代码
      configuration: { baseURL: config.baseUrl.replace(/\/+$/, '') },
    }) as unknown as BaseChatModel;
  }

  /** 是否在降级模式运行（前端与后台据此展示） */
  get isMockMode(): boolean {
    return this.current.isMock || !this.config.current.apiKey;
  }

  status() {
    // 注意用 this.current 而不是 this.provider：前者会先按最新配置重建实例，
    // 否则后台刚保存完 Key，这里读到的还是重建前的旧 provider（mock）
    const provider = this.current;
    const config = this.config.current;
    return {
      provider: provider.name,
      model: provider.model,
      mock: provider.isMock,
      baseUrl: provider.isMock ? null : config.baseUrl,
      embedding: config.embeddingModel ? 'enabled' : 'disabled',
      /** 配置来自 .env 还是后台保存的数据库配置 */
      configSource: this.config.isOverridden('apiKey') ? 'admin' : 'env',
    };
  }

  /** 供后台「测试连接」与实际调用复用的一份配置 */
  get runtimeConfig(): LlmRuntimeConfig {
    return this.config.current;
  }

  /** 是否具备识图能力（需要单独的视觉模型） */
  get visionEnabled(): boolean {
    return Boolean(this.config.current.visionModel) && !this.current.isMock;
  }

  /**
   * 用视觉模型把图片转成结构化描述。
   * 这是「拍照找同款」的第一步：图 → 文本标签 → 文本向量 / 关键词检索商品。
   * 没有视觉模型时返回 null，由调用方降级为「让用户描述或扫码」。
   */
  async describeImage(imageUrl: string): Promise<{ title: string; keywords: string[]; raw: string } | null> {
    if (!this.visionEnabled) return null;
    const config = this.config.current;
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const absolute = imageUrl.startsWith('http') ? imageUrl : (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3100') + imageUrl;
    // 视觉请求同样要有超时，否则上游卡住会一直占着这个请求
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.visionModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '这是「AI优选零食」商城里的一件商品（校园零食或二手教材）。用 JSON 回答：{"title":"品类名","keywords":["最多5个可用于检索的关键词，例如 辣条/薯片/高等数学/考研"]}。只输出 JSON。' },
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
      if (start < 0 || end <= start) throw new Error('视觉模型没有返回 JSON');
      const parsed = JSON.parse(text.slice(start, end + 1)) as { title?: string; keywords?: string[] };
      return { title: String(parsed.title ?? ''), keywords: (parsed.keywords ?? []).map(String), raw: text };
    } catch (error) {
      this.logger.warn('识图失败: ' + (error as Error).message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 后台「测试连接」：发一个最小请求验证 Key / Base URL / 模型名是否可用。
   * 对不懂技术的买家来说，这一颗按钮比任何文档都有用。
   */
  async testConnection(override?: Partial<LlmRuntimeConfig>): Promise<{ ok: boolean; message: string; model?: string; latencyMs?: number }> {
    const config = { ...this.config.current, ...override };
    if (!config.apiKey) return { ok: false, message: '还没有填写 API Key' };
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 20000));
    try {
      const response = await fetch(config.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: '回复两个字：正常' }],
          max_tokens: 8,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        return { ok: false, message: '模型接口返回 ' + response.status + '：' + text.slice(0, 200) };
      }
      const json = JSON.parse(text) as { choices?: unknown[] };
      if (!json.choices?.length) return { ok: false, message: '接口通了，但返回内容不符合 OpenAI 格式：' + text.slice(0, 200) };
      return { ok: true, message: '连接成功，模型可用', model: config.model, latencyMs: Date.now() - started };
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? '连接超时，检查 Base URL 或网络' : (error as Error).message;
      return { ok: false, message: '连接失败：' + message };
    } finally {
      clearTimeout(timer);
    }
  }
}