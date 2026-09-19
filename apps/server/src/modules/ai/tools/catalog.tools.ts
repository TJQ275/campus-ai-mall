import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CatalogService } from '../../catalog/catalog.service.js';
import { DB } from '../../database/database.module.js';
import type { Db } from '../../../db/client.js';
import { userProfiles } from '../../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { AiTool, ToolResult } from './tool.types.js';

const yuan = (cents: number) => '¥' + (cents / 100).toFixed(2);

/** 导购相关的工具：搜商品、看详情、读画像 */
@Injectable()
export class CatalogTools {
  constructor(
    private readonly catalog: CatalogService,
    @Inject(DB) private readonly db: Db,
  ) {}

  all(): AiTool[] {
    return [this.searchProducts(), this.getProductDetail(), this.getUserProfile(), this.updatePreference()];
  }

  private searchProducts(): AiTool {
    return {
      name: 'search_products',
      label: '正在检索商品',
      description:
        '按关键词、品类、价格、标签、成色、课程检索在售商品。用户说「想吃辣的」「20 元以内」「高数教材」这类需求时用它。价格单位是元。返回商品卡片，可直接展示给用户。',
      schema: z.object({
        keyword: z.string().optional().describe('关键词，如 辣条 / 高等数学 / 四级真题'),
        kind: z.enum(['snack', 'book']).optional().describe('snack=零食，book=二手书'),
        priceMin: z.number().optional().describe('最低价（元）'),
        priceMax: z.number().optional().describe('最高价（元）'),
        tags: z.array(z.string()).optional().describe('标签，如 辣 / 甜 / 宿舍必备 / 考研 / 有笔记'),
        condition: z.enum(['new', 'like_new', 'good', 'fair']).optional().describe('二手书成色'),
        course: z.string().optional().describe('适用课程，如 高等数学 / 数据结构'),
        sort: z.enum(['default', 'sales', 'price_asc', 'price_desc', 'newest']).optional(),
        pageSize: z.number().int().min(1).max(10).optional().describe('返回数量，默认 5'),
      }),
      run: async (_ctx, args): Promise<ToolResult> => {
        const result = await this.catalog.search({
          keyword: args.keyword as string | undefined,
          kind: args.kind as 'snack' | 'book' | undefined,
          priceMin: args.priceMin as number | undefined,
          priceMax: args.priceMax as number | undefined,
          tags: args.tags as string[] | undefined,
          condition: args.condition as never,
          course: args.course as string | undefined,
          sort: (args.sort as never) ?? 'default',
          pageSize: (args.pageSize as number) ?? 5,
        });
        const brief = result.total
          ? '找到 ' + result.total + ' 件商品，展示前 ' + result.list.length + ' 件'
          : '没有符合条件的商品';
        return {
          brief,
          cards: result.list,
          data: {
            total: result.total,
            items: result.list.map((p) => ({
              productId: p.id, title: p.title, price: yuan(p.priceCents), priceCents: p.priceCents,
              kind: p.kind, tags: p.tags, stock: p.stock, sales: p.sales,
            })),
          },
        };
      },
    };
  }

  private getProductDetail(): AiTool {
    return {
      name: 'get_product_detail',
      label: '正在查看商品详情',
      description: '查询单个商品的详情，包含库存、销量、成色、适用课程和 AI 评论摘要。需要回答「这个辣不辣」「还有货吗」时使用。',
      schema: z.object({
        productId: z.number().int().positive().optional().describe('商品 ID，不传则使用当前页面正在浏览的商品'),
      }),
      run: async (ctx, args): Promise<ToolResult> => {
        const fromPage = ctx.pageContext?.productId as number | undefined;
        const productId = (args.productId as number | undefined) ?? fromPage;
        if (!productId) throw new Error('没有指定商品，也没有页面上下文');
        const detail = await this.catalog.detail(productId, ctx.userId);
        return {
          brief: '「' + detail.title + '」' + yuan(detail.priceCents) + '，库存 ' + detail.stock,
          cards: [{ id: detail.id, kind: detail.kind, title: detail.title, subtitle: detail.subtitle, cover: detail.cover, priceCents: detail.priceCents, originalPriceCents: detail.originalPriceCents, sales: detail.sales, stock: detail.stock, tags: detail.tags ?? [], ratingAvg: detail.ratingAvg }],
          data: {
            productId: detail.id, title: detail.title, price: yuan(detail.priceCents), stock: detail.stock,
            spicyLevel: detail.spicyLevel, flavor: detail.flavor, condition: detail.condition, hasNotes: detail.hasNotes,
            course: detail.course, isbn: detail.isbn, description: detail.description,
            reviewSummary: detail.reviewSummary
              ? { summary: detail.reviewSummary.summary, pros: detail.reviewSummary.pros, cons: detail.reviewSummary.cons }
              : null,
          },
        };
      },
    };
  }

  private getUserProfile(): AiTool {
    return {
      name: 'get_user_profile',
      label: '正在读取你的口味偏好',
      description: '读取用户的口味画像（辣度、甜度）、忌口过敏、预算、专业年级与长期记忆。推荐前先看这个，避免推荐忌口商品。',
      schema: z.object({}),
      run: async (ctx): Promise<ToolResult> => {
        const profile = (await this.db.select().from(userProfiles).where(eq(userProfiles.userId, ctx.userId)).limit(1))[0];
        return {
          brief: profile ? '已读取口味与忌口偏好' : '该用户还没有画像',
          data: profile
            ? {
                taste: profile.taste, avoidTags: profile.avoidTags, budgetMaxCents: profile.budgetMaxCents,
                budgetMax: profile.budgetMaxCents ? yuan(profile.budgetMaxCents) : null,
                major: profile.major, grade: profile.grade, preferredKinds: profile.preferredKinds,
                memory: profile.aiMemory,
              }
            : { taste: {}, avoidTags: [] },
        };
      },
    };
  }

  private updatePreference(): AiTool {
    return {
      name: 'update_user_preference',
      label: '正在记住你的偏好',
      description: '当用户明确表达口味偏好、忌口或过敏信息时调用，写入长期记忆，下次推荐直接生效。',
      schema: z.object({
        taste: z.record(z.string(), z.unknown()).optional().describe('口味画像，如 {"spicy": 5}'),
        avoidTags: z.array(z.string()).optional().describe('忌口或过敏原，如 ["花生"]'),
        budgetMax: z.number().optional().describe('预算上限（元）'),
        memory: z.string().optional().describe('需要长期记住的一句话'),
      }),
      run: async (ctx, args): Promise<ToolResult> => {
        const existing = (await this.db.select().from(userProfiles).where(eq(userProfiles.userId, ctx.userId)).limit(1))[0];
        const patch = {
          taste: (args.taste as Record<string, unknown>) ?? existing?.taste ?? {},
          avoidTags: (args.avoidTags as string[]) ?? existing?.avoidTags ?? [],
          budgetMaxCents: args.budgetMax !== undefined ? Math.round(Number(args.budgetMax) * 100) : existing?.budgetMaxCents ?? 0,
          aiMemory: (args.memory as string) ?? existing?.aiMemory ?? null,
          updatedAt: new Date(),
        };
        if (existing) await this.db.update(userProfiles).set(patch).where(eq(userProfiles.userId, ctx.userId));
        else await this.db.insert(userProfiles).values({ userId: ctx.userId, ...patch });
        return { brief: '已更新用户画像', data: { updated: true, ...patch } };
      },
    };
  }
}
