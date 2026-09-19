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
}

/** HNSW 索引手写创建：让向量检索走索引而不是全表扫描 */
export async function ensureVectorIndexes(handle: DbHandle): Promise<void> {
  const statements = [
    "CREATE INDEX IF NOT EXISTS idx_product_embedding ON product USING hnsw (embedding vector_cosine_ops)",
    "CREATE INDEX IF NOT EXISTS idx_pimage_embedding ON product_image USING hnsw (embedding vector_cosine_ops)",
    "CREATE INDEX IF NOT EXISTS idx_aiknow_embedding ON ai_knowledge USING hnsw (embedding vector_cosine_ops)",
    "CREATE INDEX IF NOT EXISTS idx_product_fts ON product USING gin (to_tsvector('simple', title || ' ' || coalesce(subtitle, '')))",
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
