import { config } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 脚本专用的 .env 加载器。
 *
 * NestJS 那边用 ConfigModule 的 envFilePath 能同时找仓库根目录，
 * 但 tsx 直接跑的脚本（db:push / db:seed / ai:embed / demo:prepare）如果只用
 * dotenv/config，就只会读 cwd/.env —— 而 monorepo 的 .env 在仓库根目录，
 * 于是脚本会静默落到默认值（DB_DRIVER=pglite），出现「服务连 PG、脚本连 PGlite」的错位。
 * 这里按 cwd → 仓库根 的顺序找，先找到先用。
 */
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
];

for (const file of candidates) {
  if (fs.existsSync(file)) {
    config({ path: file });
    break;
  }
}
