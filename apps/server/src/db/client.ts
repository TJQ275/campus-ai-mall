import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { NodeFS } from '@electric-sql/pglite/nodefs';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as schema from './schema/index.js';

/**
 * 统一数据库句柄。
 *
 * 同一份 Drizzle schema 同时驱动两种运行形态：
 *   - pglite   ：本地零安装开发（WASM 版 PostgreSQL 18 + pgvector，跑在 Node 进程内）
 *   - postgres ：生产 / 团队协作（docker compose 起的 pgvector/pgvector:pg16）
 * 业务代码只依赖 Db 类型，不感知底层驱动。
 */
export type Db = NodePgDatabase<typeof schema>;
export type DbDriver = 'pglite' | 'postgres';

export interface DbHandle {
  db: Db;
  driver: DbDriver;
  exec(sqlText: string): Promise<void>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  driver?: DbDriver;
  dataDir?: string;
  url?: string;
  migrationsFolder?: string;
}

const migrationsFolder = (custom?: string) =>
  custom ?? path.resolve(process.cwd(), 'drizzle');

export async function createDb(options: CreateDbOptions = {}): Promise<DbHandle> {
  const driver = (options.driver ?? (process.env.DB_DRIVER as DbDriver) ?? 'pglite') as DbDriver;
  const folder = migrationsFolder(options.migrationsFolder);

  if (driver === 'postgres') {
    const url = options.url ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DB_DRIVER=postgres 时必须提供 DATABASE_URL');
    const pool = new Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      driver,
      async exec(sqlText) { await pool.query(sqlText); },
      async migrate() { await migratePg(db as never, { migrationsFolder: folder }); },
      async close() { await pool.end(); },
    };
  }

  const dataDir = path.resolve(options.dataDir ?? process.env.PGLITE_DATA_DIR ?? '.data/pg');
  // PGlite 只会 mkdir 一级目录，父目录需要自己建
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite({ dataDir, fs: new NodeFS(dataDir), extensions: { vector } });
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    driver: 'pglite',
    async exec(sqlText) { await client.exec(sqlText); },
    async migrate() { await migratePglite(db as never, { migrationsFolder: folder }); },
    async close() { await client.close(); },
  };
}

/** 建立 pgvector 扩展与向量索引：必须在迁移之前执行 */
export async function ensureVectorExtension(handle: DbHandle): Promise<void> {
  await handle.exec('CREATE EXTENSION IF NOT EXISTS vector;');
  // pg_trgm 让 ILIKE '%关键词%' 能走 GIN 索引（商品检索与知识库关键词检索都靠它）
  try {
    await handle.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  } catch (error) {
    console.warn('[db] pg_trgm 扩展创建失败，模糊搜索将退化为全表扫描:', (error as Error).message);
  }
}

/**
 * 索引创建：向量走 HNSW，文本检索走 pg_trgm GIN。
 *
 * 早期只建了 to_tsvector 的 GIN 索引，但业务查询用的是 ILIKE '%kw%' ——
 * 前缀通配的 ILIKE 用不上那个索引，等于白建（而且没有 trgm 时是全表顺序扫描）。
 * 现在按代码里真实的查询条件建索引。
 */
export async function ensureVectorIndexes(handle: DbHandle): Promise<void> {
  const statements = [
    // 向量检索
    "CREATE INDEX IF NOT EXISTS idx_product_embedding ON product USING hnsw (embedding vector_cosine_ops)",
    "CREATE INDEX IF NOT EXISTS idx_pimage_embedding ON product_image USING hnsw (embedding vector_cosine_ops)",
    "CREATE INDEX IF NOT EXISTS idx_aiknow_embedding ON ai_knowledge USING hnsw (embedding vector_cosine_ops)",
    // 商品关键词检索（catalog.service.search 的 ILIKE 条件）
    "CREATE INDEX IF NOT EXISTS idx_product_title_trgm ON product USING gin (title gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_product_subtitle_trgm ON product USING gin (subtitle gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_product_course_trgm ON product USING gin (course gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_product_author_trgm ON product USING gin (author gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_product_tags_trgm ON product USING gin ((tags::text) gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_product_isbn ON product (isbn)",
    // 列表页常用排序/过滤
    "CREATE INDEX IF NOT EXISTS idx_product_status_sales ON product (status, sales DESC)",
    "CREATE INDEX IF NOT EXISTS idx_order_user_created ON \"order\" (user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_cart_user_selected ON cart_item (user_id, selected)",
    // 知识库关键词检索（embedding 不可用时的降级路径）
    "CREATE INDEX IF NOT EXISTS idx_aiknow_title_trgm ON ai_knowledge USING gin (title gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_aiknow_content_trgm ON ai_knowledge USING gin (content gin_trgm_ops)",
    // 历史遗留：用不上的 FTS 索引，顺手清掉
    "DROP INDEX IF EXISTS idx_product_fts",
  ];
  for (const statement of statements) {
    try {
      await handle.exec(statement);
    } catch (error) {
      // 索引失败不应阻断启动（例如旧版本 pgvector 不支持 hnsw）
      console.warn('[db] 索引创建跳过:', statement, (error as Error).message);
    }
  }
}

export { schema };
