import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { users, walletLogs } from '../../db/schema/index.js';

@Injectable()
export class WalletService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async info(userId: number) {
    const user = (await this.db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    return { balanceCents: user?.balanceCents ?? 0 };
  }

  logs(userId: number) {
    return this.db.select().from(walletLogs).where(eq(walletLogs.userId, userId)).orderBy(desc(walletLogs.createdAt)).limit(50);
  }

  /** 模拟充值：真实项目在这里接微信支付回调，校园项目直接入账 */
  async recharge(userId: number, amountCents: number, channel: 'wechat' | 'alipay' = 'wechat') {
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new BadRequestException('充值金额不合法');
    if (amountCents > 100000) throw new BadRequestException('单次充值不能超过 1000 元');

    return this.db.transaction(async (tx) => {
      // 用 SQL 表达式在数据库里自增，而不是「读出来 + 加 + 写回去」——
      // 后者在并发下会丢更新（充值和下单支付同时发生时会凭空少一笔钱）
      const updated = await tx
        .update(users)
        .set({ balanceCents: sql`${users.balanceCents} + ${amountCents}` })
        .where(eq(users.id, userId))
        .returning({ balanceCents: users.balanceCents });
      if (!updated[0]) throw new BadRequestException('用户不存在');
      await tx.insert(walletLogs).values({
        userId, type: 'recharge', amountCents, balanceAfter: updated[0].balanceCents,
        refType: 'recharge', remark: channel === 'alipay' ? '支付宝模拟充值' : '微信模拟充值',
      });
      return { balanceCents: updated[0].balanceCents };
    });
  }
}
