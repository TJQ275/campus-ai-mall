import './env.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client.js';

/**
 * 清空演示交易数据：pnpm --filter @campus/server data:clear-demo
 *
 * 场景：交付/演示用的 seed 数据里带有假订单、假流水、假售后。正式运营前要清掉，
 * 让后台的统计从 0 开始，只反映真实顾客产生的交易。
 *
 * 保留：商品、分类、用户账号、知识库、评价（以及由评价算出的评分）
 * 清空：订单/订单明细、支付流水、售后单、钱包流水、AI 会话与工具日志、行为埋点
 * 连带重置：商品销量（由订单算出）、用户余额（充值来自被清掉的模拟流水）
 *
 * 执行前会把要删的数据整表导出到 backups/ 目录，出错了可以照着还原。
 */
const CLEAR_TABLES = [
  'payment',
  'after_sale',
  'order_item',
  'order',
  'wallet_log',
  'ai_pending_action',
  'ai_tool_call',
  'ai_message',
  'ai_conversation',
  'ai_feedback',
  'user_behavior',
] as const;

async function count(db: Db, table: string): Promise<number> {
  const result = await db.execute(sql.raw('select count(*)::int as n from "' + table + '"'));
  return (result as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
}

async function dump(db: Db, table: string): Promise<unknown[]> {
  const result = await db.execute(sql.raw('select * from "' + table + '"'));
  return (result as unknown as { rows: unknown[] }).rows;
}

async function main() {
  const handle = await createDb();
  const db = handle.db;

  console.log('[clear] driver =', handle.driver);
  console.log('\n--- 清理前 ---');
  const before: Record<string, number> = {};
  for (const table of CLEAR_TABLES) {
    before[table] = await count(db, table);
    console.log(String(before[table]).padStart(6), table);
  }
  console.log(String(await count(db, 'product')).padStart(6), 'product  (保留)');
  console.log(String(await count(db, 'app_user')).padStart(6), 'app_user (保留)');

  const total = Object.values(before).reduce((sum, n) => sum + n, 0);
  const resetUsers = process.argv.includes('--reset-users');

  // 交易表已经空了，且没有要求清账号 → 没什么可做的
  if (!total && !resetUsers) {
    const kept = await db.execute(sql`select count(*)::int as n from app_user where role <> 'admin'`);
    const n = (kept as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    console.log('\n[clear] 交易数据已经是空的，无需清理。');
    if (n) {
      console.log('提示：还有 ' + n + ' 个非管理员账号。想让「用户数」也从 0 开始，加 --reset-users：');
      console.log('      pnpm --filter @campus/server data:clear-demo --reset-users');
    }
    await handle.close();
    return;
  }

  // 备份：整表导出成 JSON，按时间戳分目录
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.resolve(process.cwd(), 'backups', 'demo-clear-' + stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const table of CLEAR_TABLES) {
    if (!before[table]) continue;
    fs.writeFileSync(path.join(backupDir, table + '.json'), JSON.stringify(await dump(db, table), null, 2));
  }
  // 商品销量与用户余额也会被改动，一起备一份原始值
  const productSales = await db.execute(sql`select id, sales, rating_avg, rating_count from product`);
  fs.writeFileSync(
    path.join(backupDir, '_product_sales.json'),
    JSON.stringify((productSales as unknown as { rows: unknown[] }).rows, null, 2),
  );
  const balances = await db.execute(sql`select id, nickname, balance_cents from app_user`);
  fs.writeFileSync(
    path.join(backupDir, '_user_balance.json'),
    JSON.stringify((balances as unknown as { rows: unknown[] }).rows, null, 2),
  );
  if (resetUsers) {
    const users = await db.execute(sql`select * from app_user where role <> 'admin'`);
    fs.writeFileSync(
      path.join(backupDir, '_users_to_delete.json'),
      JSON.stringify((users as unknown as { rows: unknown[] }).rows, null, 2),
    );
  }
  console.log('\n[clear] 已备份到:', backupDir);

  // 删除：子表在前，避免外键报错
  console.log('\n--- 清理中 ---');
  for (const table of CLEAR_TABLES) {
    await db.execute(sql.raw('delete from "' + table + '"'));
    console.log('  已清空', table);
  }

  // 销量是由订单累加出来的，订单清了就必须归零，否则商品页会显示「已售 186 件」这种假数字
  await db.execute(sql`update product set sales = 0`);
  // 余额来自模拟充值，流水已经清掉，留着就是一笔没有来源的假钱
  await db.execute(sql`update app_user set balance_cents = 0`);
  console.log('  已重置 product.sales = 0');
  console.log('  已重置 app_user.balance_cents = 0');

  // 可选：连测试/演示账号一起清掉。
  // 每次用新 code 调 wx/login 都会建一个账号，联调几轮下来「用户数」就全是僵尸号。
  // 管理员账号（role='admin'）永远保留。
  if (resetUsers) {
    const doomed = await db.execute(sql`select count(*)::int as n from app_user where role <> 'admin'`);
    const n = (doomed as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    if (n) {
      await db.execute(sql`delete from address where user_id in (select id from app_user where role <> 'admin')`);
      await db.execute(sql`delete from cart_item where user_id in (select id from app_user where role <> 'admin')`);
      await db.execute(sql`delete from user_profile where user_id in (select id from app_user where role <> 'admin')`);
      await db.execute(sql`delete from notification where user_id in (select id from app_user where role <> 'admin')`);
      await db.execute(sql`delete from login_log where user_id in (select id from app_user where role <> 'admin')`);
      await db.execute(sql`delete from app_user where role <> 'admin'`);
      console.log('  已删除 ' + n + ' 个非管理员账号（含其地址、购物车、画像、通知与登录日志）');
    }
  } else {
    const kept = await db.execute(sql`select count(*)::int as n from app_user where role <> 'admin'`);
    const n = (kept as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    if (n) {
      console.log('\n提示：还有 ' + n + ' 个非管理员账号（演示/测试时自动创建的）。');
      console.log('      想让「用户数」也从 0 开始，加 --reset-users 再跑一次：');
      console.log('      pnpm --filter @campus/server data:clear-demo --reset-users');
    }
  }

  console.log('\n--- 清理后 ---');
  for (const table of CLEAR_TABLES) {
    console.log(String(await count(db, table)).padStart(6), table);
  }
  console.log(String(await count(db, 'product')).padStart(6), 'product  (保留)');
  console.log(String(await count(db, 'app_user')).padStart(6), 'app_user (保留管理员)');
  console.log(String(await count(db, 'review')).padStart(6), 'review   (保留)');
  console.log(String(await count(db, 'ai_knowledge')).padStart(6), 'ai_knowledge (保留)');

  console.log('\n[clear] 完成。后台「数据概览」的订单数/成交金额现在应该是 0，有真实下单才会涨。');
  await handle.close();
}

main().catch((error) => {
  console.error('[clear] 失败:', error);
  process.exit(1);
});
