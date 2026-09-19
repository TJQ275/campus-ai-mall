import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import {
  addresses, cartItems, orderItems, orders, payments, products, userBehaviors, users, walletLogs,
} from '../../db/schema/index.js';

export interface CreateOrderInput {
  addressId: number;
  remark?: string;
  /** miniapp | ai */
  source?: 'miniapp' | 'ai';
  conversationId?: number;
}

const orderNo = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  return 'C' + stamp + Math.floor(Math.random() * 9000 + 1000);
};

@Injectable()
export class OrderService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 结算预览：读购物车中已勾选的商品 */
  async preview(userId: number) {
    const rows = await this.db
      .select({
        cartId: cartItems.id,
        productId: cartItems.productId,
        skuId: cartItems.skuId,
        quantity: cartItems.quantity,
        title: products.title,
        cover: products.cover,
        spec: products.spec,
        priceCents: products.priceCents,
        stock: products.stock,
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(and(eq(cartItems.userId, userId), eq(cartItems.selected, true)));

    if (!rows.length) throw new BadRequestException('请先勾选要结算的商品');
    for (const row of rows) {
      if (row.stock < row.quantity) throw new BadRequestException('「' + row.title + '」库存不足，仅剩 ' + row.stock + ' 件');
    }
    const totalCents = rows.reduce((s, r) => s + r.priceCents * r.quantity, 0);
    const freightCents = totalCents >= 1900 ? 0 : 100;
    const addressList = await this.db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(desc(addresses.isDefault));
    return { items: rows, totalCents, freightCents, payCents: totalCents + freightCents, defaultAddress: addressList[0] ?? null, addresses: addressList };
  }

  async create(userId: number, input: CreateOrderInput) {
    const preview = await this.preview(userId);
    const address = await this.db
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, userId)))
      .limit(1);
    if (!address[0]) throw new NotFoundException('收货地址不存在');

    const source = input.source ?? 'miniapp';
    const created = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(orders)
        .values({
          orderNo: orderNo(),
          userId,
          status: 'pending_pay',
          totalCents: preview.totalCents,
          freightCents: preview.freightCents,
          payCents: preview.payCents,
          addressSnapshot: {
            receiver: address[0].receiver,
            phone: address[0].phone,
            campus: address[0].campus,
            detail: address[0].detail,
          },
          remark: input.remark ?? null,
          source,
          aiConversationId: input.conversationId ?? null,
        })
        .returning();
      const order = inserted[0];

      await tx.insert(orderItems).values(
        preview.items.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          skuId: item.skuId,
          titleSnapshot: item.title,
          coverSnapshot: item.cover,
          specSnapshot: item.spec,
          priceCents: item.priceCents,
          quantity: item.quantity,
        })),
      );

      await tx.delete(cartItems).where(and(eq(cartItems.userId, userId), eq(cartItems.selected, true)));
      return order;
    });

    void this.db.insert(userBehaviors).values({ userId, type: 'order', weight: 5 }).catch(() => undefined);
    return this.detail(userId, created.id);
  }

  /** 模拟支付：微信 / 支付宝 / 余额。余额支付会真实扣减并记流水 */
  async pay(userId: number, id: number, channel: 'wechat' | 'alipay' | 'balance') {
    const found = await this.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.userId, userId))).limit(1);
    const order = found[0];
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'pending_pay') throw new BadRequestException('订单当前状态不可支付');

    await this.db.transaction(async (tx) => {
      if (channel === 'balance') {
        const userRow = (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
        if (!userRow || userRow.balanceCents < order.payCents) throw new BadRequestException('余额不足，请先充值或换用其他支付方式');
        const balanceAfter = userRow.balanceCents - order.payCents;
        await tx.update(users).set({ balanceCents: balanceAfter }).where(eq(users.id, userId));
        await tx.insert(walletLogs).values({
          userId, type: 'consume', amountCents: -order.payCents, balanceAfter,
          refType: 'order', refId: order.id, remark: '订单支付 ' + order.orderNo,
        });
      }

      await tx.insert(payments).values({
        orderId: order.id, channel, amountCents: order.payCents, status: 'success',
        tradeNo: channel.toUpperCase() + Date.now(), paidAt: new Date(),
      });
      await tx.update(orders).set({ status: 'paid', payStatus: 'paid', payChannel: channel, paidAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, order.id));

      // 扣库存、加销量：放在支付成功之后，未支付订单取消时无需回滚
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      for (const item of items) {
        await tx
          .update(products)
          .set({ stock: sql`greatest(${products.stock} - ${item.quantity}, 0)`, sales: sql`${products.sales} + ${item.quantity}` })
          .where(eq(products.id, item.productId));
      }
    });

    return this.detail(userId, id);
  }

  async cancel(userId: number, id: number) {
    const updated = await this.db
      .update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.userId, userId), eq(orders.status, 'pending_pay')))
      .returning();
    if (!updated[0]) throw new BadRequestException('只有待付款订单可以取消');
    return updated[0];
  }

  async confirm(userId: number, id: number) {
    const updated = await this.db
      .update(orders)
      .set({ status: 'finished', finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.userId, userId), eq(orders.status, 'shipped')))
      .returning();
    if (!updated[0]) throw new BadRequestException('只有待收货订单可以确认收货');
    return updated[0];
  }

  async list(userId: number, status?: string) {
    const conditions = [eq(orders.userId, userId)];
    if (status && status !== 'all') conditions.push(eq(orders.status, status));
    const rows = await this.db.select().from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt));
    return this.withItems(rows);
  }

  async detail(userId: number, id: number) {
    const found = await this.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.userId, userId))).limit(1);
    if (!found[0]) throw new NotFoundException('订单不存在');
    return (await this.withItems(found))[0];
  }

  private async withItems(rows: (typeof orders.$inferSelect)[]) {
    if (!rows.length) return [];
    const items = await this.db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.id)));
    return rows.map((order) => ({ ...order, items: items.filter((i) => i.orderId === order.id) }));
  }

  // ────────── 管理端 ──────────

  async adminList(params: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
    const conditions = [];
    if (params.status && params.status !== 'all') conditions.push(eq(orders.status, params.status));
    if (params.keyword) {
      const like = '%' + params.keyword + '%';
      conditions.push(or(ilike(orders.orderNo, like), ilike(orders.remark, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const list = await this.db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where);
    return { list: await this.withItems(list), total: counted[0]?.total ?? 0, page, pageSize };
  }

  async ship(id: number) {
    const updated = await this.db
      .update(orders)
      .set({ status: 'shipped', shippedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.status, 'paid')))
      .returning();
    if (!updated[0]) throw new BadRequestException('只有已付款订单可以发货');
    return updated[0];
  }

  /** 概览页 KPI 与图表数据 */
  async dashboard() {
    const [kpi] = await this.db.execute(sql`
      select
        (select count(*)::int from \"order\") as order_count,
        (select coalesce(sum(pay_cents), 0)::int from \"order\" where pay_status = 'paid') as paid_cents,
        (select count(*)::int from app_user where role = 'user') as user_count,
        (select count(*)::int from product) as product_count,
        (select count(*)::int from after_sale where status = 'pending') as pending_after_sale,
        (select count(*)::int from \"order\" where source = 'ai') as ai_order_count
    `).then((r) => (r as unknown as { rows: Record<string, number>[] }).rows);
    const trend = await this.db.execute(sql`
      select to_char(created_at, 'MM-DD') as day, count(*)::int as orders, coalesce(sum(pay_cents), 0)::int as amount
      from \"order\" where created_at > now() - interval '14 days'
      group by 1 order by 1
    `).then((r) => (r as unknown as { rows: unknown[] }).rows);
    const categorySales = await this.db.execute(sql`
      select c.name, coalesce(sum(oi.quantity), 0)::int as qty
      from category c
      left join product p on p.category_id = c.id
      left join order_item oi on oi.product_id = p.id
      group by c.name order by qty desc limit 10
    `).then((r) => (r as unknown as { rows: unknown[] }).rows);
    const payChannels = await this.db.execute(sql`
      select coalesce(pay_channel, 'unpaid') as channel, count(*)::int as count
      from \"order\" group by 1
    `).then((r) => (r as unknown as { rows: unknown[] }).rows);
    return { kpi: kpi ?? {}, trend, categorySales, payChannels };
  }
}
