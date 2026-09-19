import { integer, timestamp, varchar } from 'drizzle-orm/pg-core';

/** 向量维度：与所选 embedding 模型一致（bge-m3 / text-embedding-v3 默认 1024） */
export const EMBEDDING_DIM = Number(process.env.LLM_EMBEDDING_DIM ?? 1024);

/** 金额统一用「分」存整数，避免浮点误差 */
export const money = (name: string) => integer(name).notNull().default(0);

export const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const shortText = (name: string, length = 100) => varchar(name, { length });
