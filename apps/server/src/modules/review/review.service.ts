import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { orderItems, orders, products, reviewSummaries, reviews, users } from '../../db/schema/index.js';
import { LlmService } from '../ai/llm.service.js';

export interface CreateReviewInput {
  productId: number;
  orderItemId?: number;
  rating: number;
  content?: string;
  images?: string[];
}

interface SummaryPayload {
  summary: string;
  pros: string[];
  cons: string[];
  audience: string;
  keywords: string[];
}

/**
 * 评价 + AI 评论摘要。
 * 摘要有两条生成路径：配置了模型就让它读评论吐 JSON；没配置就用模板从真实评分与文本里归纳，
 * 因此商品详情页永远有摘要可展示，不会出现「AI 功能未配置」的空窗。
 */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
  ) {}

  async create(userId: number, input: CreateReviewInput) {
    if (input.rating < 1 || input.rating > 5) throw new BadRequestException('评分必须在 1-5 之间');

    let orderItemId = input.orderItemId ?? null;
    if (orderItemId) {
      const rows = await this.db
        .select({ id: orderItems.id })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(eq(orderItems.id, orderItemId), eq(orders.userId, userId)))
        .limit(1);
      if (!rows.length) throw new BadRequestException('该订单商品不属于当前用户');
    }

    const created = await this.db
      .insert(reviews)
      .values({
        productId: input.productId,
        userId,
        orderItemId,
        rating: input.rating,
        content: input.content ?? null,
        images: input.images ?? [],
      })
      .returning();

    await this.refreshRating(input.productId);
    // 评论变化后异步刷新摘要：不阻塞用户请求，失败也不影响评价提交
    void this.summarize(input.productId).catch((error) => this.logger.warn('摘要生成失败: ' + (error as Error).message));
    return created[0];
  }

  private async refreshRating(productId: number) {
    await this.db.execute(sql`
      update product set
        rating_avg = coalesce((select round(avg(rating)::numeric, 2) from review where product_id = ${productId} and status = 1), 0),
        rating_count = (select count(*) from review where product_id = ${productId} and status = 1)
      where id = ${productId}
    `);
  }

  async listByProduct(productId: number) {
    const rows = await this.db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        content: reviews.content,
        images: reviews.images,
        createdAt: reviews.createdAt,
        nickname: users.nickname,
        avatar: users.avatar,
      })
      .from(reviews)
      .innerJoin(users, eq(reviews.userId, users.id))
      .where(and(eq(reviews.productId, productId), eq(reviews.status, 1)))
      .orderBy(desc(reviews.createdAt))
      .limit(50);
    const summary = (await this.db.select().from(reviewSummaries).where(eq(reviewSummaries.productId, productId)).limit(1))[0] ?? null;
    return { list: rows, total: rows.length, summary };
  }

  async getSummary(productId: number) {
    return (await this.db.select().from(reviewSummaries).where(eq(reviewSummaries.productId, productId)).limit(1))[0] ?? null;
  }

  /** 生成 / 刷新评论摘要 */
  async summarize(productId: number) {
    const product = (await this.db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!product) throw new NotFoundException('商品不存在');

    const rows = await this.db
      .select({ rating: reviews.rating, content: reviews.content })
      .from(reviews)
      .where(and(eq(reviews.productId, productId), eq(reviews.status, 1)));
    if (!rows.length) return null;

    const ratingDist: Record<string, number> = {};
    for (const row of rows) ratingDist[String(row.rating)] = (ratingDist[String(row.rating)] ?? 0) + 1;

    const payload = this.llm.current.isMock
      ? this.templateSummary(product, rows, ratingDist)
      : await this.llmSummary(product, rows).catch(() => this.templateSummary(product, rows, ratingDist));

    const existing = await this.getSummary(productId);
    const values = {
      productId,
      summary: payload.summary,
      pros: payload.pros,
      cons: payload.cons,
      audience: payload.audience,
      keywords: payload.keywords,
      ratingDist,
      reviewCount: rows.length,
      model: this.llm.current.isMock ? 'template' : this.llm.current.model,
      updatedAt: new Date(),
    };

    if (existing) await this.db.update(reviewSummaries).set(values).where(eq(reviewSummaries.productId, productId));
    else await this.db.insert(reviewSummaries).values(values);
    return values;
  }

  /** 无模型时的归纳：从真实评分与文本里抽取，不编造 */
  private templateSummary(
    product: typeof products.$inferSelect,
    rows: { rating: number; content: string | null }[],
    ratingDist: Record<string, number>,
  ): SummaryPayload {
    const avg = rows.reduce((sum, r) => sum + r.rating, 0) / rows.length;
    const split = (text: string | null) =>
      (text ?? '')
        .split(/[。！？!?；;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 24);

    const positives = rows.filter((r) => r.rating >= 4).flatMap((r) => split(r.content));
    const negatives = rows.filter((r) => r.rating <= 3).flatMap((r) => split(r.content));
    const pros = [...new Set(positives.length ? positives : (product.tags ?? []))].slice(0, 3);
    const cons = [...new Set(negatives)].slice(0, 3);

    const kindText = product.kind === 'book' ? '教材' : '零食';
    const notesText = product.hasNotes ? '带笔记' : '';
    const summary =
      '共 ' + rows.length + ' 条评价，平均 ' + avg.toFixed(1) + ' 分。' +
      (pros.length ? '好评集中在' + pros.join('、') + '；' : '') +
      (cons.length ? '主要槽点是' + cons.join('、') + '。' : '暂时没有集中的负反馈。');

    return {
      summary,
      pros,
      cons,
      audience: (product.course ? product.course + ' 课程的同学' : kindText + '刚需的同学') + (notesText ? '，尤其是想省复习时间的' : ''),
      keywords: [product.kind === 'book' ? '二手书' : '零食', ...(product.tags ?? []).slice(0, 3)],
    };
  }

  /** 有模型时：让模型读评论吐结构化 JSON */
  private async llmSummary(
    product: typeof products.$inferSelect,
    rows: { rating: number; content: string | null }[],
  ): Promise<SummaryPayload> {
    const prompt = [
      '你在为校园商城生成商品评论摘要。只输出 JSON，不要解释。',
      '商品：' + product.title + '（' + (product.kind === 'book' ? '二手书' : '零食') + '）',
      '评论：',
      ...rows.slice(0, 30).map((r) => r.rating + '分：' + (r.content ?? '（无文字）')),
      '输出格式：{"summary":"不超过 80 字","pros":["最多3条"],"cons":["最多3条"],"audience":"一句话描述适合谁","keywords":["最多5个关键词"]}',
    ].join('\n');

    const result = await this.llm.current.chat([{ role: 'user', content: prompt }], []);
    const text = result.content.replace(/```json|```/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<SummaryPayload>;
    return {
      summary: String(parsed.summary ?? '').slice(0, 200),
      pros: (parsed.pros ?? []).slice(0, 3).map(String),
      cons: (parsed.cons ?? []).slice(0, 3).map(String),
      audience: String(parsed.audience ?? ''),
      keywords: (parsed.keywords ?? []).slice(0, 5).map(String),
    };
  }
}
