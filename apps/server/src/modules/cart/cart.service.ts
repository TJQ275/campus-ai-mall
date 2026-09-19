import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { cartItems, products, userBehaviors } from '../../db/schema/index.js';

export interface AddCartInput {
  productId: number;
  skuId?: number;
  quantity?: number;
  /** miniapp | ai —— AI 助手加购的商品会被标记，便于统计 */
  source?: 'miniapp' | 'ai';
}

@Injectable()
export class CartService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(userId: number) {
    const rows = await this.db
      .select({
        id: cartItems.id,
        productId: cartItems.productId,
        skuId: cartItems.skuId,
        quantity: cartItems.quantity,
        selected: cartItems.selected,
        source: cartItems.source,
        title: products.title,
        cover: products.cover,
        kind: products.kind,
        priceCents: products.priceCents,
        stock: products.stock,
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.userId, userId))
      .orderBy(desc(cartItems.createdAt));

    const selected = rows.filter((r) => r.selected);
    const totalCents = selected.reduce((sum, r) => sum + r.priceCents * r.quantity, 0);
    return {
      list: rows,
      selectedCount: selected.length,
      totalCount: rows.length,
      totalCents,
      /** 满 19 元免配送费（与售后政策文案保持一致） */
      freightCents: selected.length === 0 || totalCents >= 1900 ? 0 : 100,
    };
  }

  async add(userId: number, input: AddCartInput) {
    const quantity = Math.max(1, input.quantity ?? 1);
    const found = await this.db.select().from(products).where(eq(products.id, input.productId)).limit(1);
    const product = found[0];
    if (!product || product.status !== 'on') throw new NotFoundException('商品不存在或已下架');
    if (product.stock < quantity) throw new BadRequestException('库存不足，当前仅剩 ' + product.stock + ' 件');

    const existing = await this.db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.userId, userId), eq(cartItems.productId, input.productId)))
      .limit(1);

    const source = input.source ?? 'miniapp';
    if (existing[0]) {
      const updated = await this.db
        .update(cartItems)
        .set({ quantity: existing[0].quantity + quantity, selected: true, updatedAt: new Date() })
        .where(eq(cartItems.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const inserted = await this.db
      .insert(cartItems)
      .values({ userId, productId: input.productId, skuId: input.skuId ?? null, quantity, source })
      .returning();
    void this.db.insert(userBehaviors).values({ userId, productId: input.productId, type: 'cart', weight: 3 }).catch(() => undefined);
    return inserted[0];
  }

  async update(userId: number, id: number, input: { quantity?: number; selected?: boolean }) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.quantity !== undefined) patch.quantity = Math.max(1, input.quantity);
    if (input.selected !== undefined) patch.selected = input.selected;
    const updated = await this.db
      .update(cartItems)
      .set(patch)
      .where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('购物车条目不存在');
    return updated[0];
  }

  async remove(userId: number, id: number) {
    await this.db.delete(cartItems).where(and(eq(cartItems.id, id), eq(cartItems.userId, userId)));
    return { removed: true };
  }

  async selectAll(userId: number, selected: boolean) {
    await this.db.update(cartItems).set({ selected }).where(eq(cartItems.userId, userId));
    return { selected };
  }

  async count(userId: number) {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
      .from(cartItems)
      .where(eq(cartItems.userId, userId));
    return rows[0]?.total ?? 0;
  }
}
