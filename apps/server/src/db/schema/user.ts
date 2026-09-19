import { boolean, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createdAt, money, updatedAt } from './_shared.js';

export const users = pgTable('app_user', {
  id: serial('id').primaryKey(),
  /** 微信小程序登录标识 */
  openid: varchar('openid', { length: 64 }).unique(),
  unionid: varchar('unionid', { length: 64 }),
  /** 管理后台账号（与 openid 二选一） */
  username: varchar('username', { length: 50 }).unique(),
  passwordHash: varchar('password_hash', { length: 200 }),
  nickname: varchar('nickname', { length: 50 }).notNull().default('同学'),
  avatar: varchar('avatar', { length: 500 }),
  phone: varchar('phone', { length: 20 }),
  /** user | admin */
  role: varchar('role', { length: 20 }).notNull().default('user'),
  /** 1 正常 0 禁用 */
  status: smallint('status').notNull().default(1),
  balanceCents: money('balance_cents'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt,
  updatedAt,
}, (t) => [index('idx_user_role').on(t.role)]);

/** AI 长期记忆：跨会话保存的用户画像，导购个性化与推荐理由都读这里 */
export const userProfiles = pgTable('user_profile', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** 口味画像：{ spicy: 4, sweet: 2, flavors: ['辣', '咸'] } */
  taste: jsonb('taste').$type<Record<string, unknown>>().notNull().default({}),
  /** 忌口 / 过敏原：['花生', '乳制品'] */
  avoidTags: jsonb('avoid_tags').$type<string[]>().notNull().default([]),
  budgetMinCents: money('budget_min_cents'),
  budgetMaxCents: money('budget_max_cents'),
  major: varchar('major', { length: 60 }),
  grade: varchar('grade', { length: 20 }),
  /** 偏好的品类：['snack', 'book'] */
  preferredKinds: jsonb('preferred_kinds').$type<string[]>().notNull().default([]),
  /** 模型归纳的自由记忆文本，供 prompt 直接使用 */
  aiMemory: text('ai_memory'),
  updatedAt,
});

export const addresses = pgTable('address', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  receiver: varchar('receiver', { length: 50 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  /** 校区 / 宿舍楼 */
  campus: varchar('campus', { length: 60 }),
  detail: varchar('detail', { length: 200 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt,
}, (t) => [index('idx_address_user').on(t.userId)]);

/** 行为埋点：协同过滤 + 画像 + AI 检索热度都基于这张表 */
export const userBehaviors = pgTable('user_behavior', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: integer('product_id'),
  /** view | search | cart | order | favorite | chat */
  type: varchar('type', { length: 20 }).notNull(),
  keyword: varchar('keyword', { length: 100 }),
  weight: integer('weight').notNull().default(1),
  createdAt,
}, (t) => [index('idx_behavior_user').on(t.userId), index('idx_behavior_product').on(t.productId)]);
