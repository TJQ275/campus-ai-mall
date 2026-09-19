import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { categories, products, users, walletLogs } from '../../db/schema/index.js';

/** 管理端的商品 / 分类 / 用户维护 */
@Injectable()
export class AdminShopService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async productList(params: { keyword?: string; kind?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
    const conditions = [];
    if (params.kind) conditions.push(eq(products.kind, params.kind));
    if (params.status) conditions.push(eq(products.status, params.status));
    if (params.keyword) {
      const like = '%' + params.keyword + '%';
      conditions.push(or(ilike(products.title, like), ilike(products.isbn, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const list = await this.db.select().from(products).where(where).orderBy(desc(products.id)).limit(pageSize).offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
    return { list, total: counted[0]?.total ?? 0, page, pageSize };
  }

  async productSave(input: Record<string, unknown> & { id?: number }) {
    const patch: Record<string, unknown> = { ...input, updatedAt: new Date() };
    delete patch.id;
    if (input.id) {
      const updated = await this.db.update(products).set(patch).where(eq(products.id, Number(input.id))).returning();
      if (!updated[0]) throw new NotFoundException('商品不存在');
      return updated[0];
    }
    const created = await this.db.insert(products).values(patch as never).returning();
    return created[0];
  }

  async productToggle(id: number, status: 'on' | 'off') {
    const updated = await this.db.update(products).set({ status, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    if (!updated[0]) throw new NotFoundException('商品不存在');
    return updated[0];
  }

  categoryList() {
    return this.db.select().from(categories).orderBy(asc(categories.kind), asc(categories.sort));
  }

  async categorySave(input: { id?: number; name: string; slug: string; kind: string; sort?: number; enabled?: boolean }) {
    if (input.id) {
      const updated = await this.db.update(categories).set(input).where(eq(categories.id, input.id)).returning();
      return updated[0];
    }
    const created = await this.db.insert(categories).values(input).returning();
    return created[0];
  }

  async userList(params: { keyword?: string; role?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
    const conditions = [];
    if (params.role) conditions.push(eq(users.role, params.role));
    if (params.keyword) {
      const like = '%' + params.keyword + '%';
      conditions.push(or(ilike(users.nickname, like), ilike(users.openid, like), ilike(users.phone, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const list = await this.db
      .select({
        id: users.id, nickname: users.nickname, avatar: users.avatar, role: users.role,
        status: users.status, balanceCents: users.balanceCents, openid: users.openid,
        phone: users.phone, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
    return { list, total: counted[0]?.total ?? 0, page, pageSize };
  }

  async userUpdate(id: number, input: { status?: number; role?: string; nickname?: string }) {
    const updated = await this.db.update(users).set(input).where(eq(users.id, id)).returning();
    if (!updated[0]) throw new NotFoundException('用户不存在');
    return updated[0];
  }

  /** 管理端给用户调余额（正数加、负数减），同时记流水 */
  async userAdjustBalance(id: number, amountCents: number, remark: string) {
    return this.db.transaction(async (tx) => {
      const user = (await tx.select().from(users).where(eq(users.id, id)).limit(1))[0];
      if (!user) throw new NotFoundException('用户不存在');
      const balanceAfter = user.balanceCents + amountCents;
      await tx.update(users).set({ balanceCents: balanceAfter }).where(eq(users.id, id));
      await tx.insert(walletLogs).values({
        userId: id, type: amountCents >= 0 ? 'recharge' : 'consume', amountCents, balanceAfter,
        refType: 'admin', remark,
      });
      return { balanceCents: balanceAfter };
    });
  }
}
