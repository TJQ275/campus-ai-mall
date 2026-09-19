import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { aiKnowledge, products } from '../../db/schema/index.js';
import { LlmService } from './llm.service.js';

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
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.LLM_EMBEDDING_MODEL) && !this.llm.current.isMock;
  }

  async embed(texts: string[]): Promise<number[][] | null> {
    if (!this.enabled) return null;
    const fn = this.llm.current.embed;
    if (!fn) return null;
    try {
      return (await fn.call(this.llm.current, texts)) ?? null;
    } catch (error) {
      this.logger.warn('embedding 调用失败，退回关键词检索: ' + (error as Error).message);
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