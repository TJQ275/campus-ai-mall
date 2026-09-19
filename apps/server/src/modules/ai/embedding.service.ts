import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { aiKnowledge, products } from '../../db/schema/index.js';
import { EMBEDDING_DIM } from '../../db/schema/_shared.js';
import { LlmService } from './llm.service.js';
import { AiUsageService } from './usage.service.js';

/**
 * 向量能力开关。
 * 配置了 LLM_EMBEDDING_MODEL 才有语义检索；否则检索自动退回关键词/全文，
 * 上层（知识库工具、找同款）不需要关心走的是哪条路。
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
    private readonly usage: AiUsageService,
  ) {}

  /** 最近一次向量调用失败的原因。失败是「静默降级」，不记下来就没人知道检索其实已经退化了 */
  private lastFailure: { message: string; at: number; model: string } | null = null;

  get enabled(): boolean {
    return Boolean(this.llm.runtimeConfig.embeddingModel) && !this.llm.current.isMock;
  }

  /**
   * 向量检索的健康状况，给管理后台展示用。
   *
   * 为什么需要：embedding 失败时系统会**自动退回关键词检索**，业务不报错、
   * 但检索质量已经悄悄降级了。实测把 embeddingModel 填成 deepseek-flash（DeepSeek 没有
   * 向量接口）时，每次知识库检索都打一次 404 再重试，日志里全是告警，而页面上完全看不出来。
   */
  health() {
    const model = this.llm.runtimeConfig.embeddingModel;
    return {
      enabled: this.enabled,
      model: model || null,
      /** 配了模型但最近一次调用失败 —— 说明向量检索实际不可用，正在吃关键词兜底 */
      failing: Boolean(this.lastFailure),
      lastError: this.lastFailure?.message ?? null,
      lastErrorAt: this.lastFailure ? new Date(this.lastFailure.at).toISOString() : null,
      /** 常见误配提示 */
      hint: this.lastFailure && /404|not found|does not exist/i.test(this.lastFailure.message)
        ? '该服务商可能没有向量接口（DeepSeek 就没有）。请换成具备 embedding 的服务，例如通义 text-embedding-v3、智谱 embedding-3，或本地 Ollama 的 nomic-embed-text。'
        : null,
    };
  }

  async embed(texts: string[]): Promise<number[][] | null> {
    if (!this.enabled) return null;
    const provider = this.llm.current;
    if (!provider.embed) return null;
    try {
      const vectors = await provider.embed(texts);
      if (!vectors?.length) return null;
      // 向量维度和建表时声明的维度必须一致，否则写库会直接报错。
      // 这里提前拦住并给出可执行的提示，同时降级为关键词检索，避免整条链路挂掉。
      if (vectors[0].length !== EMBEDDING_DIM) {
        this.logger.error(
          'embedding 维度不匹配：模型输出 ' + vectors[0].length + ' 维，数据库列是 vector(' + EMBEDDING_DIM + ')。' +
            '请改用 ' + EMBEDDING_DIM + ' 维的向量模型，或改 LLM_EMBEDDING_DIM 后重建向量列。当前已降级为关键词检索。',
        );
        return null;
      }
      // 向量调用也花钱，记一笔账。
      // 上游只回向量、不回 usage，所以按字符数估算 token：
      // 中文约 1 字 ≈ 1 token，英文约 4 字符 ≈ 1 token，取 1.5 字符/token 折中。
      // 是估算值，但对「向量花了多少钱」这个量级判断足够用。
      const chars = texts.reduce((sum, t) => sum + (t?.length ?? 0), 0);
      await this.usage.record({
        model: this.llm.runtimeConfig.embeddingModel || provider.model,
        kind: 'embedding',
        promptTokens: Math.ceil(chars / 1.5),
        completionTokens: 0,
      });
      this.lastFailure = null;
      return vectors;
    } catch (error) {
      const message = (error as Error).message;
      // 记下来，让后台能显示「向量检索已失效，当前在用关键词兜底」
      this.lastFailure = { message, at: Date.now(), model: this.llm.runtimeConfig.embeddingModel };
      this.logger.warn('embedding 调用失败，退回关键词检索: ' + message);
      return null;
    }
  }

  /** 为缺失向量的商品与知识库条目补向量（pnpm ai:embed 调用） */
  async backfill(limit = 200): Promise<{ products: number; knowledge: number; skipped: boolean }> {
    if (!this.enabled) return { products: 0, knowledge: 0, skipped: true };

    const pendingProducts = await this.db
      .select({ id: products.id, title: products.title, subtitle: products.subtitle, tags: products.tags, kind: products.kind, course: products.course })
      .from(products)
      .where(isNull(products.embedding))
      .limit(limit);

    if (pendingProducts.length) {
      const vectors = await this.embed(
        pendingProducts.map((p) =>
          [p.title, p.subtitle ?? '', (p.tags ?? []).join(' '), p.course ?? '', p.kind === 'book' ? '二手书 教材' : '零食'].join(' '),
        ),
      );
      if (vectors) {
        for (let i = 0; i < pendingProducts.length; i += 1) {
          await this.db.update(products).set({ embedding: vectors[i] }).where(eq(products.id, pendingProducts[i].id));
        }
      }
    }

    const pendingKnowledge = await this.db
      .select({ id: aiKnowledge.id, title: aiKnowledge.title, content: aiKnowledge.content })
      .from(aiKnowledge)
      .where(isNull(aiKnowledge.embedding))
      .limit(limit);

    if (pendingKnowledge.length) {
      const vectors = await this.embed(pendingKnowledge.map((k) => k.title + ' | ' + k.content));
      if (vectors) {
        for (let i = 0; i < pendingKnowledge.length; i += 1) {
          await this.db.update(aiKnowledge).set({ embedding: vectors[i] }).where(eq(aiKnowledge.id, pendingKnowledge[i].id));
        }
      }
    }

    return { products: pendingProducts.length, knowledge: pendingKnowledge.length, skipped: false };
  }

  /** 语义检索知识库：返回带相似度的条目；未启用向量时返回 null，由调用方退回关键词 */
  async searchKnowledgeByVector(query: string, limit = 4) {
    const vectors = await this.embed([query]);
    if (!vectors) return null;
    const literal = JSON.stringify(vectors[0]);
    const result = await this.db.execute(sql`
      select id, title, source, content, 1 - (embedding <=> ${literal}::vector) as score
      from ai_knowledge
      where enabled = true and embedding is not null
      order by embedding <=> ${literal}::vector
      limit ${limit}
    `);
    return (result as unknown as { rows: { id: number; title: string; source: string; content: string; score: number }[] }).rows;
  }

  /** 语义检索商品：返回 id 与相似度；未启用向量时返回 null */
  async searchProductsByVector(query: string, limit = 5, kind?: 'snack' | 'book') {
    const vectors = await this.embed([query]);
    if (!vectors) return null;
    const literal = JSON.stringify(vectors[0]);
    const kindFilter = kind ? sql`and p.kind = ${kind}` : sql``;
    const result = await this.db.execute(sql`
      select p.id, 1 - (p.embedding <=> ${literal}::vector) as score
      from product p
      where p.status = 'on' and p.embedding is not null ${kindFilter}
      order by p.embedding <=> ${literal}::vector
      limit ${limit}
    `);
    return (result as unknown as { rows: { id: number; score: number }[] }).rows;
  }
}