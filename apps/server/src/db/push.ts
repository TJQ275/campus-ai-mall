import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDb, ensureVectorExtension, ensureVectorIndexes } from './client.js';

/**
 * 建表脚本：pnpm db:push [--reset]
 *
 * 顺序很重要：先 CREATE EXTENSION vector，再跑迁移（迁移 SQL 里有 vector 列），
 * 最后补 HNSW / GIN 索引。drizzle-kit 的 push 无法处理扩展依赖，所以自己来。
 */
async function main() {
  const reset = process.argv.includes('--reset');
  const handle = await createDb();
  console.log('[db] driver =', handle.driver);

  if (reset) {
    console.log('[db] --reset：清空 public schema 与迁移记录');
    // 必须连 drizzle schema 一起删：迁移记录还在的话 migrate() 会认为已经建过表而跳过
    await handle.exec('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  }

  await ensureVectorExtension(handle);
  await handle.migrate();
  await ensureVectorIndexes(handle);

  const tables = await handle.db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `);
  const names = (tables as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
  console.log('[db] 建表完成，共', names.length, '张:', names.join(', '));
  await handle.close();
}

main().catch((error) => {
  console.error('[db] 建表失败:', error);
  process.exit(1);
});
