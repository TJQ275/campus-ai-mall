import { defineConfig } from 'drizzle-kit';

/**
 * 只用于 drizzle-kit generate / studio（离线读 schema 生成 SQL）。
 * 真正执行建表走 src/db/push.ts —— 它会先建 vector 扩展再跑迁移，
 * 这样 PGlite（本地零安装）和真实 PostgreSQL（生产）都能用同一套迁移。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://campus:campus@localhost:5432/campus_mall',
  },
  verbose: true,
  strict: false,
});
