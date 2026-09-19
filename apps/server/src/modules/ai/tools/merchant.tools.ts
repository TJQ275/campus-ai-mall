import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DB } from '../../database/database.module.js';
import type { Db } from '../../../db/client.js';
import { afterSales, orderItems, orders, products, users } from '../../../db/schema/index.js';
import { CopywritingService } from '../copywriting.service.js';
import type { AiTool, ToolResult } from './tool.types.js';

const yuan = (cents: number) => '¥' + (cents / 100).toFixed(2);
const RANGE_DAYS: Record<string, number> = { last_7_days: 7, last_30_days: 30, last_90_days: 90 };

/**
 * 商家侧工具。
 *
 * 经营数据查询刻意**不做 NL2SQL** —— 让模型直接写 SQL 跑在生产库上是不可接受的风险。
 * 这里改成「指标枚举白名单」：模型只能从固定的几个指标里选，SQL 全部由后端预置，
 * 既能用自然语言问，又不可能被注入或扫全表。
 */
@Injectable()
export class MerchantTools {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly copywriting: CopywritingService,
  ) {}

  all(): AiTool[] {
    return [this.businessOverview(), this.queryBusinessData(), this.generateCopywriting(), this.productPerformance()];
  }

  private businessOverview(): AiTool {
    return {
      name: 'get_business_overview',
      label: '正在汇总经营概览',
      description: '获取店铺整体经营概览：订单数、成交金额、用户数、商品数、待处理售后、AI 促成订单占比，以及近 14 天趋势。回答「最近生意怎么样」时使用。',
      schema: z.object({}),
      scenes: ['merchant'],
      run: async (): Promise<ToolResult> => {
        const kpiResult = await this.db.execute(sql`
          select
            (select count(*)::int from \"order\") as order_count,
            (select coalesce(sum(pay_cents), 0)::int from \"order\" where pay_status = 'paid') as paid_cents,
            (select count(*)::int from app_user where role = 'user') as user_count,
            (select count(*)::int from product) as product_count,
            (select count(*)::int from after_sale where status = 'pending') as pending_after_sale,
            (select count(*)::int from \"order\" where source = 'ai') as ai_order_count
        `);
        const kpi = (kpiResult as unknown as { rows: Record<string, number>[] }).rows[0] ?? {};
        const trendResult = await this.db.execute(sql`
          select to_char(created_at, 'MM-DD') as day, count(*)::int as orders, coalesce(sum(pay_cents), 0)::int as amount
          from \"order\" where created_at > now() - interval '14 days'
          group by 1 order by 1
        `);
        const trend = (trendResult as unknown as { rows: { day: string; orders: number; amount: number }[] }).rows;
        const aiRatio = kpi.order_count ? Math.round((kpi.ai_order_count / kpi.order_count) * 100) : 0;
        return {
          brief:
            '共 ' + kpi.order_count + ' 笔订单、成交 ' + yuan(kpi.paid_cents ?? 0) + '，待处理售后 ' + kpi.pending_after_sale + ' 单，AI 促成占比 ' + aiRatio + '%',
          data: {
            kpi: { ...kpi, paid: yuan(kpi.paid_cents ?? 0), aiOrderRatio: aiRatio + '%' },
            trend,
          },
        };
      },
    };
  }

  private queryBusinessData(): AiTool {
    return {
      name: 'query_business_data',
      label: '正在统计经营数据',
      description:
        '按白名单指标查询经营数据。metric 可选：top_products（热销商品）、category_sales（分类销量）、sales_trend（成交趋势）、refund_stats（退款统计）、user_growth（用户增长）、ai_orders（AI 促成订单）。range 可选 last_7_days / last_30_days / last_90_days / all。',
      schema: z.object({
        metric: z.enum(['top_products', 'category_sales', 'sales_trend', 'refund_stats', 'user_growth', 'ai_orders']),
        range: z.enum(['last_7_days', 'last_30_days', 'last_90_days', 'all']).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      scenes: ['merchant'],
      run: async (_ctx, args): Promise<ToolResult> => {
        const metric = String(args.metric);
        const range = String(args.range ?? 'last_30_days');
        const limit = Number(args.limit ?? 10);
        const days = RANGE_DAYS[range] ?? 30;
        const since = range === 'all' ? new Date(0) : new Date(Date.now() - days * 86400000);

        switch (metric) {
          case 'top_products': {
            const rows = await this.db.execute(sql`
              select p.title, p.kind, sum(oi.quantity)::int as qty, sum(oi.price_cents * oi.quantity)::int as amount
              from order_item oi join product p on p.id = oi.product_id join \"order\" o on o.id = oi.order_id
              where o.pay_status = 'paid' and o.created_at >= ${since}
              group by p.title, p.kind order by qty desc limit ${limit}
            `);
            const list = (rows as unknown as { rows: { title: string; qty: number; amount: number }[] }).rows;
            return {
              brief: '热销 Top' + list.length + '：' + list.slice(0, 3).map((r) => r.title + '(' + r.qty + '件)').join('、'),
              data: { metric, range, list: list.map((r) => ({ ...r, amountText: yuan(r.amount) })) },
            };
          }
          case 'category_sales': {
            const rows = await this.db.execute(sql`
              select c.name, c.kind, coalesce(sum(oi.quantity), 0)::int as qty
              from category c
              left join product p on p.category_id = c.id
              left join order_item oi on oi.product_id = p.id
              left join \"order\" o on o.id = oi.order_id and o.pay_status = 'paid' and o.created_at >= ${since}
              group by c.name, c.kind order by qty desc limit ${limit}
            `);
            const list = (rows as unknown as { rows: unknown[] }).rows;
            return { brief: '分类销量已汇总（' + list.length + ' 个分类）', data: { metric, range, list } };
          }
          case 'sales_trend': {
            const rows = await this.db.execute(sql`
              select to_char(created_at, 'MM-DD') as day, count(*)::int as orders, coalesce(sum(pay_cents), 0)::int as amount
              from \"order\" where pay_status = 'paid' and created_at >= ${since}
              group by 1 order by 1
            `);
            const list = (rows as unknown as { rows: unknown[] }).rows;
            return { brief: '成交趋势 ' + list.length + ' 天', data: { metric, range, list } };
          }
          case 'refund_stats': {
            const rows = await this.db.execute(sql`
              select status, count(*)::int as count, coalesce(sum(amount_cents), 0)::int as amount
              from after_sale where created_at >= ${since} group by status
            `);
            const list = (rows as unknown as { rows: { status: string; count: number; amount: number }[] }).rows;
            const total = list.reduce((sum, r) => sum + r.count, 0);
            return {
              brief: '近 ' + days + ' 天售后 ' + total + ' 单：' + list.map((r) => r.status + ' ' + r.count).join('、'),
              data: { metric, range, list: list.map((r) => ({ ...r, amountText: yuan(r.amount) })) },
            };
          }
          case 'user_growth': {
            const rows = await this.db.execute(sql`
              select to_char(created_at, 'YYYY-MM-DD') as day, count(*)::int as count
              from app_user where role = 'user' and created_at >= ${since}
              group by 1 order by 1
            `);
            const list = (rows as unknown as { rows: unknown[] }).rows;
            return { brief: '新增用户 ' + list.length + ' 天有数据', data: { metric, range, list } };
          }
          case 'ai_orders':
          default: {
            const rows = await this.db.execute(sql`
              select source, count(*)::int as count, coalesce(sum(pay_cents), 0)::int as amount
              from \"order\" where created_at >= ${since} group by source
            `);
            const list = (rows as unknown as { rows: { source: string; count: number; amount: number }[] }).rows;
            const ai = list.find((r) => r.source === 'ai')?.count ?? 0;
            const total = list.reduce((sum, r) => sum + r.count, 0);
            return {
              brief: 'AI 促成 ' + ai + '/' + total + ' 单（' + (total ? Math.round((ai / total) * 100) : 0) + '%）',
              data: { metric: 'ai_orders', range, list: list.map((r) => ({ ...r, amountText: yuan(r.amount) })) },
            };
          }
        }
      },
    };
  }

  private generateCopywriting(): AiTool {
    return {
      name: 'generate_copywriting',
      label: '正在生成商品文案',
      description: '为指定商品生成标题、卖点、详情描述与推荐标签。style 可选 student（学生口语）、professional（正式）、playful（活泼）。',
      schema: z.object({
        productId: z.number().int().positive().optional().describe('商品 ID，不传则使用当前页面上下文里的商品'),
        style: z.enum(['student', 'professional', 'playful']).optional(),
      }),
      scenes: ['merchant'],
      run: async (ctx, args): Promise<ToolResult> => {
        const productId = Number(args.productId ?? ctx.pageContext?.productId ?? 0);
        if (!productId) {
          return { brief: '需要先确定是哪件商品', data: { needProduct: true, hint: '请问要给它写文案的是哪件商品？可以报商品名，或先打开它的详情页再问我。' } };
        }
        const result = await this.copywriting.generate(productId, (args.style as string) ?? 'student');
        return {
          brief: '已生成「' + result.productTitle + '」的文案（' + result.model + '）',
          data: result,
        };
      },
    };
  }

  private productPerformance(): AiTool {
    return {
      name: 'get_product_performance',
      label: '正在分析商品表现',
      description: '查看某个商品的销量、浏览量、退款情况与评分，用于判断要不要继续推。',
      schema: z.object({ productId: z.number().int().positive() }),
      scenes: ['merchant'],
      run: async (_ctx, args): Promise<ToolResult> => {
        const id = Number(args.productId);
        const product = (await this.db.select().from(products).where(eq(products.id, id)).limit(1))[0];
        if (!product) return { brief: '商品不存在', data: { found: false } };
        const soldResult = await this.db.execute(sql`
          select coalesce(sum(oi.quantity), 0)::int as sold from order_item oi
          join \"order\" o on o.id = oi.order_id where oi.product_id = ${id} and o.pay_status = 'paid'
        `);
        const sold = (soldResult as unknown as { rows: { sold: number }[] }).rows[0]?.sold ?? 0;
        const refundResult = await this.db.execute(sql`
          select count(*)::int as count from after_sale where order_item_id in
          (select id from order_item where product_id = ${id}) and status = 'refunded'
        `);
        const refunds = (refundResult as unknown as { rows: { count: number }[] }).rows[0]?.count ?? 0;
        return {
          brief: product.title + '：累计售出 ' + sold + ' 件，退款 ' + refunds + ' 单，评分 ' + product.ratingAvg.toFixed(1),
          data: {
            productId: id, title: product.title, price: yuan(product.priceCents), stock: product.stock,
            viewCount: product.viewCount, sold, refunds, ratingAvg: product.ratingAvg, ratingCount: product.ratingCount,
            conversion: product.viewCount ? ((sold / product.viewCount) * 100).toFixed(1) + '%' : '未知',
          },
        };
      },
    };
  }
}