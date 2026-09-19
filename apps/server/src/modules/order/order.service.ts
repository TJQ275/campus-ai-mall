import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import {
  addresses, afterSales, cartItems, orderItems, orders, payments, products, userBehaviors, users, walletLogs,
} from '../../db/schema/index.js';

export interface CreateOrderInput {
  addressId: number;
  remark?: string;
  /** miniapp | ai */
  source?: 'miniapp' | 'ai';
  conversationId?: number;
}

/**
 * 订单号：日期 + 10 位随机数。
 * 早期实现是「秒级时间戳 + 4 位随机」（同秒仅 9000 种），并发下单有碰撞概率，
 * 而 order_no 上有唯一索引 —— 撞上就是一次 500。按天分段的 10 位随机空间是 10^10。
 */
const orderNo = () => {
  const d = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const day = String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
  return 'C' + day + String(randomInt(0, 10_000_000_000)).padStart(10, '0');
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

  /**
   * 模拟支付：微信 / 支付宝 / 余额。余额支付会真实扣减并记流水。
   *
   * 幂等靠「事务内的条件更新抢占」实现：只有把订单从 pending_pay 改到 paid 的那一次
   * 更新能拿到返回行，并发重复支付（用户连点、网络重试）会在数据库行锁上排队，
   * 后到的请求拿不到行、直接失败。所有扣减都带条件，扣不动就整体回滚。
   */
  async pay(userId: number, id: number, channel: 'wechat' | 'alipay' | 'balance') {
    await this.db.transaction(async (tx) => {
      // 1) 抢占订单：并发时只有一个请求能把 pending_pay 改成 paid
      const claimed = await tx
        .update(orders)
        .set({ status: 'paid', payStatus: 'paid', payChannel: channel, paidAt: new Date(), updatedAt: new Date() })
        .where(and(eq(orders.id, id), eq(orders.userId, userId), eq(orders.status, 'pending_pay')))
        .returning();
      const order = claimed[0];
      if (!order) {
        // 区分「不存在」和「状态不对」，给前端准确提示（重复支付应提示已支付，而非报错）
        const existing = (
          await tx.select({ status: orders.status }).from(orders).where(and(eq(orders.id, id), eq(orders.userId, userId))).limit(1)
        )[0];
        if (!existing) throw new NotFoundException('订单不存在');
        throw new BadRequestException(existing.status === 'paid' ? '订单已支付，请勿重复支付' : '订单当前状态不可支付');
      }

      // 2) 扣库存 / 加销量：条件更新，库存不足时返回 0 行 → 抛错回滚整个事务
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      for (const item of items) {
        const deducted = await tx
          .update(products)
          .set({ stock: sql`${products.stock} - ${item.quantity}`, sales: sql`${products.sales} + ${item.quantity}` })
          .where(and(eq(products.id, item.productId), gte(products.stock, item.quantity)))
          .returning({ id: products.id });
        if (!deducted[0]) {
          throw new BadRequestException('「' + item.titleSnapshot + '」库存不足，请取消订单后重新下单');
        }
      }

      // 3) 余额扣减：条件更新，余额不足时数据库层面就拒绝，不会出现读改写覆盖
      if (channel === 'balance') {
        const paid = await tx
          .update(users)
          .set({ balanceCents: sql`${users.balanceCents} - ${order.payCents}` })
          .where(and(eq(users.id, userId), gte(users.balanceCents, order.payCents)))
          .returning({ balanceCents: users.balanceCents });
        if (!paid[0]) throw new BadRequestException('余额不足，请先充值或换用其他支付方式');
        await tx.insert(walletLogs).values({
          userId, type: 'consume', amountCents: -order.payCents, balanceAfter: paid[0].balanceCents,
          refType: 'order', refId: order.id, remark: '订单支付 ' + order.orderNo,
        });
      }

      await tx.insert(payments).values({
        orderId: order.id, channel, amountCents: order.payCents, status: 'success',
        tradeNo: channel.toUpperCase() + Date.now(), paidAt: new Date(),
      });
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

  /** 最近订单（给 AI 工具用）：默认只取最近 20 笔，避免上下文与响应体无限膨胀 */
  async list(userId: number, status?: string, limit = 20) {
    const rows = await this.recentOrders(userId, status, Math.min(Math.max(1, limit), 50));
    return this.withItems(rows);
  }

  /** 小程序订单列表：分页 */
  async pageForUser(userId: number, params: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 10));
    const conditions = [eq(orders.userId, userId)];
    if (params.status && params.status !== 'all') conditions.push(eq(orders.status, params.status));
    const where = and(...conditions);
    const rows = await this.db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where);
    return { list: await this.withItems(rows), total: counted[0]?.total ?? 0, page, pageSize };
  }

  /**
   * 各状态订单数：给「我的」页面的角标用。
   * 之前是客户端拉全量订单再在本地数，订单越多越慢，这里改成一次聚合查询。
   */
  async summary(userId: number) {
    const rows = await this.db
      .select({ status: orders.status, count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, userId))
      .groupBy(orders.status);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      counts[row.status] = row.count;
      total += row.count;
    }
    const refunding = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(afterSales)
      .where(and(eq(afterSales.userId, userId), inArray(afterSales.status, ['pending', 'approved'])));
    return {
      all: total,
      pending_pay: counts.pending_pay ?? 0,
      paid: counts.paid ?? 0,
      shipped: counts.shipped ?? 0,
      finished: counts.finished ?? 0,
      cancelled: counts.cancelled ?? 0,
      /** 售后处理中（不在订单状态里，单独统计） */
      refunding: refunding[0]?.total ?? 0,
    };
  }

  private recentOrders(userId: number, status?: string, limit = 20) {
    const conditions = [eq(orders.userId, userId)];
    if (status && status !== 'all') conditions.push(eq(orders.status, status));
    return this.db.select().from(orders).where(and(...conditions)).orderBy(desc(orders.createdAt)).limit(limit);
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
