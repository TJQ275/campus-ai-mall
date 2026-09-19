import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db, DbHandle } from '../../db/client.js';
import { DB_HANDLE } from '../database/database.module.js';

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  @Get()
  @ApiOperation({ summary: '服务与数据库健康状态' })
  async check() {
    const started = Date.now();
    const result = await this.db.execute(sql`
      select count(*)::int as tables from information_schema.tables where table_schema = 'public'
    `);
    const rows = (result as unknown as { rows: { tables: number }[] }).rows;
    return {
      status: 'ok',
      db: { driver: this.handle.driver, tables: rows[0]?.tables ?? 0, latencyMs: Date.now() - started },
      llm: { configured: Boolean(process.env.LLM_API_KEY), model: process.env.LLM_MODEL ?? null },
      time: new Date().toISOString(),
    };
  }
}
