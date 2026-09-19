import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { categories, loginLogs, orderItems, products, users, walletLogs } from '../../db/schema/index.js';
import { CatalogService } from '../catalog/catalog.service.js';

/** 管理端的商品 / 分类 / 用户维护 */
@Injectable()
export class AdminShopService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
  ) {}

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

  /**
   * 新增 / 更新商品。
   *
   * 只接受白名单字段 —— 早期实现是 `{ ...input }` 全量铺进 SQL，客户端可以顺手改
   * sales / ratingAvg / viewCount / embedding 这些统计与向量字段（批量赋值漏洞）。
   * 不在白名单里的键直接忽略，而不是报错，这样前端多传字段也不会崩。
   */
  async productSave(input: Record<string, unknown> & { id?: number }) {
    const patch: Record<string, unknown> = {};
    const text = (key: string, max: number) => {
      if (input[key] === undefined) return;
      const value = input[key];
      if (value === null) { patch[key] = null; return; }
      patch[key] = String(value).slice(0, max);
    };
    const num = (key: string) => {
      if (input[key] === undefined || input[key] === null) return;
      const value = Number(input[key]);
      if (Number.isFinite(value)) patch[key] = Math.trunc(value);
    };

    text('kind', 10);
    text('title', 120);
    text('subtitle', 200);
    text('description', 5000);
    text('cover', 500);
    text('status', 10);
    text('flavor', 40);
    text('spec', 40);
    text('isbn', 20);
    text('author', 80);
    text('publisher', 80);
    text('edition', 40);
    text('course', 80);
    text('condition', 10);
    num('categoryId');
    num('priceCents');
    num('originalPriceCents');
    num('stock');
    num('spicyLevel');
    num('shelfLifeDays');
    if (input.images !== undefined && Array.isArray(input.images)) {
      patch.images = input.images.filter((i) => typeof i === 'string').slice(0, 9).map((i) => String(i).slice(0, 500));
    }
    if (input.tags !== undefined && Array.isArray(input.tags)) {
      patch.tags = input.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 12).map((t) => String(t).trim().slice(0, 20));
    }
    if (input.hasNotes !== undefined) patch.hasNotes = Boolean(input.hasNotes);

    // 新增必填：标题、品类、价格、分类
    if (!input.id) {
      if (!patch.title) throw new BadRequestException('商品标题不能为空');
      if (!patch.kind) throw new BadRequestException('请选择商品品类（snack 零食 / book 二手书）');
      if (patch.priceCents === undefined) throw new BadRequestException('商品价格不能为空');
      if (patch.categoryId === undefined) throw new BadRequestException('请选择商品分类');
      patch.stock = patch.stock ?? 0;
      patch.status = patch.status ?? 'on';
    }
    patch.updatedAt = new Date();

    if (input.id) {
      const updated = await this.db.update(products).set(patch).where(eq(products.id, Number(input.id))).returning();
      if (!updated[0]) throw new NotFoundException('商品不存在');
      return updated[0];
    }
    const created = await this.db.insert(products).values(patch as never).returning();
    return created[0];
  }

  /**
   * 删除商品。
   *
   * 已经产生过订单的商品不允许硬删：订单、售后、经营统计都靠 product_id 关联，
   * 删掉之后历史数据就对不上了。这种情况引导卖家改用「下架」——
   * 下架后小程序立刻搜不到，但已下单的订单、售后记录都完好。
   */
  async productRemove(id: number) {
    const product = (await this.db.select().from(products).where(eq(products.id, id)).limit(1))[0];
    if (!product) throw new NotFoundException('商品不存在');

    const counted = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderItems)
      .where(eq(orderItems.productId, id));
    const orderCount = counted[0]?.count ?? 0;
    if (orderCount > 0) {
      throw new BadRequestException(
        '「' + product.title + '」已经产生了 ' + orderCount + ' 条订单记录，删除会让历史订单和经营统计对不上。' +
          '请改用「下架」：下架后小程序立刻搜不到，已下单的订单不受影响。',
      );
    }

    // 购物车、评价、SKU、图片、标签都配了级联删除，这里删主表即可
    await this.db.delete(products).where(eq(products.id, id));
    return { removed: true, id, title: product.title };
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
    // 同上：显式挑字段，避免把任意键写进 SQL
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = String(input.name).slice(0, 40);
    if (input.slug !== undefined) patch.slug = String(input.slug).slice(0, 40);
    if (input.kind !== undefined) patch.kind = String(input.kind).slice(0, 10);
    if (input.sort !== undefined && Number.isFinite(Number(input.sort))) patch.sort = Math.trunc(Number(input.sort));
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);

    if (input.id) {
      const updated = await this.db.update(categories).set(patch).where(eq(categories.id, input.id)).returning();
      if (!updated[0]) throw new NotFoundException('分类不存在');
      this.catalog.clearCategoryCache();
      return updated[0];
    }
    if (!patch.name || !patch.slug || !patch.kind) throw new BadRequestException('分类名称、标识、品类都不能为空');
    const created = await this.db.insert(categories).values(patch as never).returning();
    this.catalog.clearCategoryCache();
    return created[0];
  }

  /** 登录记录：谁在什么时候用哪个账号登录、成功还是失败 */
  async loginLogList(params: { keyword?: string; result?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const conditions = [];
    if (params.result === 'ok') conditions.push(eq(loginLogs.success, true));
    if (params.result === 'fail') conditions.push(eq(loginLogs.success, false));
    if (params.keyword) conditions.push(ilike(loginLogs.username, '%' + params.keyword + '%')!);
    const where = conditions.length ? and(...conditions) : undefined;
    const list = await this.db
      .select()
      .from(loginLogs)
      .where(where)
      .orderBy(desc(loginLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(loginLogs).where(where);
    return { list, total: counted[0]?.total ?? 0, page, pageSize };
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

  /**
   * 修改用户状态 / 角色 / 昵称。
   * 早期实现是 `set(input)` 全量透传 —— 未校验的 body 能直接改 openid / password_hash /
   * balance_cents，等于把任意账号交给调用方。这里显式白名单。
   */
  async userUpdate(id: number, input: { status?: number; role?: string; nickname?: string }) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = Number(input.status) === 0 ? 0 : 1;
    if (input.role !== undefined) {
      if (!['user', 'admin'].includes(String(input.role))) throw new BadRequestException('角色只能是 user 或 admin');
      patch.role = String(input.role);
    }
    if (input.nickname !== undefined) patch.nickname = String(input.nickname).slice(0, 50) || '同学';

    const updated = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!updated[0]) throw new NotFoundException('用户不存在');
    return updated[0];
  }

  /** 管理端给用户调余额（正数加、负数减），同时记流水 */
  async userAdjustBalance(id: number, amountCents: number, remark: string) {
    if (!Number.isFinite(amountCents) || amountCents === 0) throw new BadRequestException('调整金额必须是非 0 整数（单位：分）');
    const delta = Math.trunc(amountCents);

    return this.db.transaction(async (tx) => {
      // 原子自增；扣减时带条件，余额不足直接拒绝，不会把用户余额扣成负数
      const updated = await tx
        .update(users)
        .set({ balanceCents: sql`${users.balanceCents} + ${delta}` })
        .where(delta >= 0 ? eq(users.id, id) : and(eq(users.id, id), gte(users.balanceCents, -delta)))
        .returning({ balanceCents: users.balanceCents });
      if (!updated[0]) {
        const exists = (await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1))[0];
        if (!exists) throw new NotFoundException('用户不存在');
        throw new BadRequestException('扣减后余额会变成负数，请先核对金额');
      }
      await tx.insert(walletLogs).values({
        userId: id, type: delta >= 0 ? 'recharge' : 'consume', amountCents: delta,
        balanceAfter: updated[0].balanceCents, refType: 'admin', remark: remark.slice(0, 200),
      });
      return { balanceCents: updated[0].balanceCents };
    });
  }
}