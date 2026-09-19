import './env.js';
import { createDb } from './client.js';
import { LlmService } from '../modules/ai/llm.service.js';
import { ReviewService } from '../modules/review/review.service.js';
import { sql } from 'drizzle-orm';

/**
 * 演示准备：pnpm demo:prepare
 *
 * 把所有「有评价但还没有摘要」的商品的 AI 评论摘要生成一遍。
 * 用了真实的 ReviewService，所以有模型就用模型、没模型就用模板路径，结果与线上完全一致。
 */
async function main() {
  const handle = await createDb();
  const llm = new LlmService();
  const review = new ReviewService(handle.db, llm);

  const rows = await handle.db.execute(sql`
    select p.id, p.title, count(r.id)::int as review_count
    from product p join review r on r.product_id = p.id
    left join review_summary s on s.product_id = p.id
    group by p.id, p.title, s.product_id
    having s.product_id is null or count(r.id) > (select review_count from review_summary where product_id = p.id)
  `);
  const targets = (rows as unknown as { rows: { id: number; title: string; review_count: number }[] }).rows;

  if (!targets.length) {
    console.log('[demo] 所有有评价的商品都已有摘要，无需处理。');
    await handle.close();
    return;
  }

  for (const target of targets) {
    const result = await review.summarize(target.id);
    console.log('[demo] ' + target.title + '（' + target.review_count + ' 条评价）→ ' + (result ? result.summary.slice(0, 40) + '…' : '跳过'));
  }
  console.log('[demo] 共刷新 ' + targets.length + ' 个商品的评论摘要');
  await handle.close();
}

main().catch((error) => {
  console.error('[demo] 失败:', error);
  process.exit(1);
});