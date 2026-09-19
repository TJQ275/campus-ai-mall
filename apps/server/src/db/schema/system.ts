import { boolean, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createdAt } from './_shared.js';

export const sysMenus = pgTable('sys_menu', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id'),
  name: varchar('name', { length: 40 }).notNull(),
  path: varchar('path', { length: 120 }),
  icon: varchar('icon', { length: 60 }),
  sort: integer('sort').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdAt,
});

export const sysConfigs = pgTable('sys_config', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 80 }).notNull().unique(),
  value: text('value'),
  remark: varchar('remark', { length: 200 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 登录日志 */
export const loginLogs = pgTable('login_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: varchar('username', { length: 50 }),
  ip: varchar('ip', { length: 60 }),
  userAgent: varchar('user_agent', { length: 300 }),
  success: boolean('success').notNull().default(true),
  message: varchar('message', { length: 200 }),
  createdAt,
}, (t) => [index('idx_loginlog_user').on(t.userId)]);

/** 操作日志：管理端与 AI 的写操作都记这里 */
export const operationLogs = pgTable('operation_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  /** admin | ai */
  actor: varchar('actor', { length: 20 }).notNull().default('admin'),
  module: varchar('module', { length: 40 }).notNull(),
  action: varchar('action', { length: 40 }).notNull(),
  targetId: varchar('target_id', { length: 60 }),
  detail: jsonb('detail').$type<Record<string, unknown>>(),
  ip: varchar('ip', { length: 60 }),
  createdAt,
}, (t) => [index('idx_oplog_module').on(t.module)]);

export const notifications = pgTable('notification', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  /** order | after_sale | ai | system */
  type: varchar('type', { length: 20 }).notNull().default('system'),
  title: varchar('title', { length: 120 }).notNull(),
  content: text('content'),
  read: smallint('read').notNull().default(0),
  createdAt,
}, (t) => [index('idx_notify_user').on(t.userId)]);
