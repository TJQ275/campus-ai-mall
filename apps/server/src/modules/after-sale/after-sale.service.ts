import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { afterSales, orderItems, orders, products, users, walletLogs } from '../../db/schema/index.js';

export interface ApplyAfterSaleInput {
  orderItemId: number;
  type?: 'refund' | 'return';
  reason: string;
  description?: string;
  images?: string[];
  /** miniapp | ai —— AI 客服代提交的售后单独统计 */
  source?: 'miniapp' | 'ai';
}

/** 售后单号：日期 + 10 位随机数（同秒并发不会再碰撞） */
const afterSaleNo = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
  return 'A' + day + String(randomInt(0, 10_000_000_000)).padStart(10, '0');
};

@Injectable()
export class AfterSaleService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async apply(userId: number, input: ApplyAfterSaleInput) {
    const found = await this.db.select().from(orderItems).where(eq(orderItems.id, input.orderItemId)).limit(1);
    const item = found[0];
    if (!item) throw new NotFoundException('订单商品不存在');

    const orderRow = (await this.db.select().from(orders).where(eq(orders.id, item.orderId)).limit(1))[0];
    if (!orderRow || orderRow.userId !== userId) throw new NotFoundException('订单不存在');
    if (!['paid', 'shipped', 'finished'].includes(orderRow.status)) throw new BadRequestException('该订单当前状态不支持申请售后');

    // 抢占订单行：把 refund_status 从 none 改成 pending 的条件更新，只有一次能成功。
    // 之前是「先 select 判断再 insert」，并发重复提交会开出两张售后单。
    return this.db.transaction(async (tx) => {
      const claimed = await tx
        .update(orderItems)
        .set({ refundStatus: 'pending' })
        .where(and(eq(orderItems.id, item.id), eq(orderItems.refundStatus, 'none')))
        .returning({ id: orderItems.id });
      if (!claimed[0]) throw new BadRequestException('该商品已有售后单在处理中');

      const created = await tx
        .insert(afterSales)
        .values({
          afterSaleNo: afterSaleNo(),
          orderId: orderRow.id,
          orderItemId: item.id,
          userId,
          type: input.type ?? 'refund',
          reason: input.reason,
          description: input.description ?? null,
          images: input.images ?? [],
          amountCents: item.priceCents * item.quantity,
          status: 'pending',
          source: input.source ?? 'miniapp',
        })
        .returning();
      return created[0];
    });
  }

  async list(userId: number, status?: string) {
    const conditions = [eq(afterSales.userId, userId)];
    if (status && status !== 'all') conditions.push(eq(afterSales.status, status));
    return this.db.select().from(afterSales).where(and(...conditions)).orderBy(desc(afterSales.createdAt));
  }

  async cancel(userId: number, id: number) {
    const updated = await this.db
      .update(afterSales)
      .set({ status: 'cancelled' })
      .where(and(eq(afterSales.id, id), eq(afterSales.userId, userId), eq(afterSales.status, 'pending')))
      .returning();
    if (!updated[0]) throw new BadRequestException('只有待审核的售后单可以撤销');
    await this.db.update(orderItems).set({ refundStatus: 'none' }).where(eq(orderItems.id, updated[0].orderItemId));
    return updated[0];
  }

  async adminList(params: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
    const conditions = [];
    if (params.status && params.status !== 'all') conditions.push(eq(afterSales.status, params.status));
    if (params.keyword) conditions.push(or(ilike(afterSales.afterSaleNo, '%' + params.keyword + '%'), ilike(afterSales.reason, '%' + params.keyword + '%'))!);
    const where = conditions.length ? and(...conditions) : undefined;
    const list = await this.db.select().from(afterSales).where(where).orderBy(desc(afterSales.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(afterSales).where(where);
    return { list, total: counted[0]?.total ?? 0, page, pageSize };
  }

  /**
   * 审核售后：同意则退款入账 + 回滚库存与销量。
   * 这条链路同时被「管理端按钮」和「AI 客服代提交后的审核」复用。
   *
   * 两条分支都在事务里用条件更新抢占售后单（WHERE status='pending'），
   * 重复点击审核不会出现「退两次款」。
   */
  async audit(id: number, input: { approve: boolean; remark?: string; adminId?: number }) {
    const found = await this.db.select().from(afterSales).where(eq(afterSales.id, id)).limit(1);
    const record = found[0];
    if (!record) throw new NotFoundException('售后单不存在');

    if (!input.approve) {
      return this.db.transaction(async (tx) => {
        const rejected = await tx
          .update(afterSales)
          .set({ status: 'rejected', auditRemark: input.remark ?? null, auditedBy: input.adminId ?? null, auditedAt: new Date() })
          .where(and(eq(afterSales.id, id), eq(afterSales.status, 'pending')))
          .returning();
        if (!rejected[0]) throw new BadRequestException('该售后单已处理');
        await tx.update(orderItems).set({ refundStatus: 'rejected' }).where(eq(orderItems.id, record.orderItemId));
        return rejected[0];
      });
    }

    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(afterSales)
        .set({ status: 'refunded', auditRemark: input.remark ?? '审核通过', auditedBy: input.adminId ?? null, auditedAt: new Date() })
        .where(and(eq(afterSales.id, id), eq(afterSales.status, 'pending')))
        .returning();
      if (!updated[0]) throw new BadRequestException('该售后单已处理');

      await tx.update(orderItems).set({ refundStatus: 'refunded' }).where(eq(orderItems.id, record.orderItemId));

      // 退款入账：原子自增，避免与用户同时下单支付互相覆盖
      const credited = await tx
        .update(users)
        .set({ balanceCents: sql`${users.balanceCents} + ${record.amountCents}` })
        .where(eq(users.id, record.userId))
        .returning({ balanceCents: users.balanceCents });
      if (credited[0]) {
        await tx.insert(walletLogs).values({
          userId: record.userId, type: 'refund', amountCents: record.amountCents, balanceAfter: credited[0].balanceCents,
          refType: 'after_sale', refId: record.id, remark: '售后退款 ' + record.afterSaleNo,
        });
      }

      const item = (await tx.select().from(orderItems).where(eq(orderItems.id, record.orderItemId)).limit(1))[0];
      if (item) {
        await tx
          .update(products)
          .set({ stock: sql`${products.stock} + ${item.quantity}`, sales: sql`greatest(${products.sales} - ${item.quantity}, 0)` })
          .where(eq(products.id, item.productId));
      }
      return updated[0];
    });
  }
}
