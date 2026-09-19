import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { products, userProfiles } from '../../db/schema/index.js';
import type { ProductCard } from './catalog.service.js';

const yuan = (cents: number) => '¥' + (cents / 100).toFixed(2);

/**
 * 推荐服务：协同过滤（UserCF 简化版）+ 可解释的推荐理由。
 *
 * 理由优先来自用户画像（口味 / 预算 / 课程），其次来自协同过滤来源，
 * 最后退到销量与评分 —— 任何一条推荐都能说出「为什么推给你」，这是答辩和演示的重点。
 */
@Injectable()
export class RecommendService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async forUser(userId: number | undefined, options: { kind?: 'snack' | 'book'; limit?: number } = {}) {
    const limit = options.limit ?? 6;
    if (!userId) return this.hotFallback(options, '登录后可以按你的口味推荐');

    const profile = (await this.db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1))[0] ?? null;

    // 1) UserCF：找和当前用户行为重叠最多的用户，取他们买过而我没买过的商品
    const cfResult = await this.db.execute(sql`
      with mine as (
        select distinct product_id from user_behavior
        where user_id = ${userId} and product_id is not null
      ),
      neighbors as (
        select user_id, count(*)::int as overlap
        from user_behavior
        where user_id <> ${userId} and product_id in (select product_id from mine)
        group by user_id order by overlap desc limit 20
      ),
      cand as (
        select ub.product_id, sum(ub.weight)::int as score
        from user_behavior ub
        where ub.user_id in (select user_id from neighbors)
          and ub.product_id is not null
          and ub.product_id not in (select product_id from mine)
        group by ub.product_id order by score desc limit ${limit}
      )
      select p.id, c.score from cand c join product p on p.id = c.product_id
      where p.status = 'on'
    `);
    const scored = (cfResult as unknown as { rows: { id: number; score: number }[] }).rows;
    const cfIds = scored.map((r) => r.id);

    const picked: (typeof products.$inferSelect)[] = [];
    if (cfIds.length) {
      const idList = sql.join(cfIds.map((id) => sql`${id}`), sql`, `);
      const rows = await this.db.select().from(products).where(sql`${products.id} = any(ARRAY[${idList}]::int[])`);
      picked.push(...rows);
    }

    // 2) 不足时用画像偏好的标签补齐
    const flavors = ((profile?.taste as { flavors?: string[] } | null)?.flavors ?? []).filter(Boolean);
    if (picked.length < limit && flavors.length) {
      const exclude = picked.map((p) => p.id);
      const list = sql.join(flavors.map((f) => sql`${f}`), sql`, `);
      const rows = await this.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.status, 'on'),
            options.kind ? eq(products.kind, options.kind) : sql`true`,
            sql`${products.tags} ?| ARRAY[${list}]::text[]`,
            exclude.length ? notInArray(products.id, exclude) : sql`true`,
          ),
        )
        .orderBy(desc(products.sales))
        .limit(limit - picked.length);
      picked.push(...rows);
    }

    // 3) 还不够就热销补齐
    if (picked.length < limit) {
      const exclude = picked.map((p) => p.id);
      const rows = await this.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.status, 'on'),
            options.kind ? eq(products.kind, options.kind) : sql`true`,
            exclude.length ? notInArray(products.id, exclude) : sql`true`,
          ),
        )
        .orderBy(desc(products.sales))
        .limit(limit - picked.length);
      picked.push(...rows);
    }

    const cfSet = new Set(cfIds);
    return picked.slice(0, limit).map((p) => ({
      ...this.toCard(p),
      reason: this.reason(p, profile, cfSet.has(p.id)),
      source: cfSet.has(p.id) ? 'user-cf' : 'profile-or-hot',
    }));
  }

  private async hotFallback(options: { kind?: 'snack' | 'book'; limit?: number }, reason: string) {
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.status, 'on'), options.kind ? eq(products.kind, options.kind) : sql`true`))
      .orderBy(desc(products.sales))
      .limit(options.limit ?? 6);
    return rows.map((p) => ({ ...this.toCard(p), reason, source: 'hot' }));
  }

  private toCard(p: typeof products.$inferSelect): ProductCard {
    return {
      id: p.id, kind: p.kind, title: p.title, subtitle: p.subtitle, cover: p.cover,
      priceCents: p.priceCents, originalPriceCents: p.originalPriceCents,
      sales: p.sales, stock: p.stock, tags: p.tags ?? [], ratingAvg: p.ratingAvg,
    };
  }

  /** 可解释推荐：按优先级挑一条最能说服人的理由 */
  private reason(p: typeof products.$inferSelect, profile: typeof userProfiles.$inferSelect | null, fromCf: boolean): string {
    const tastes = (profile?.taste as { spicy?: number; flavors?: string[] } | null) ?? {};
    const tags = p.tags ?? [];

    if (p.spicyLevel && tastes.spicy && p.spicyLevel >= 4 && tastes.spicy >= 4) return '你偏好重辣，这款辣度够劲';
    const hitFlavor = tags.find((t) => (tastes.flavors ?? []).includes(t));
    if (hitFlavor) return '你喜欢' + hitFlavor + '口的，这款正好对上';
    if (profile?.budgetMaxCents && p.priceCents <= profile.budgetMaxCents) return '在你 ' + yuan(profile.budgetMaxCents) + ' 的预算内';
    if (p.kind === 'book' && p.course && profile?.major) return '《' + p.course + '》课程用得上';
    if (p.hasNotes) return '带学长笔记，复习省事';
    if (fromCf) return '和你口味相似的同学也在买';
    if (p.sales >= 150) return '本周热销 ' + p.sales + ' 件';
    if (p.ratingAvg >= 4.5) return '评分 ' + p.ratingAvg.toFixed(1) + '，同类里靠前';
    return '同类里销量靠前';
  }
}