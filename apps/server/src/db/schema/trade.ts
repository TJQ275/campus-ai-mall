import { boolean, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createdAt, money, updatedAt } from './_shared.js';
import { products, productSkus } from './catalog.js';
import { users } from './user.js';

export const cartItems = pgTable('cart_item', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  skuId: integer('sku_id').references(() => productSkus.id, { onDelete: 'set null' }),
  quantity: integer('quantity').notNull().default(1),
  selected: boolean('selected').notNull().default(true),
  /** miniapp | ai —— 标记是否由 AI 助手加入购物车 */
  source: varchar('source', { length: 10 }).notNull().default('miniapp'),
  createdAt,
  updatedAt,
}, (t) => [index('idx_cart_user').on(t.userId)]);

export const orders = pgTable('order', {
  id: serial('id').primaryKey(),
  orderNo: varchar('order_no', { length: 32 }).notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** pending_pay | paid | shipped | finished | cancelled | closed */
  status: varchar('status', { length: 20 }).notNull().default('pending_pay'),
  totalCents: money('total_cents'),
  freightCents: money('freight_cents'),
  payCents: money('pay_cents'),
  /** wechat | alipay | balance（校园项目默认模拟支付） */
  payChannel: varchar('pay_channel', { length: 20 }),
  payStatus: varchar('pay_status', { length: 20 }).notNull().default('unpaid'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** 下单时的地址快照，避免地址被改后订单信息漂移 */
  addressSnapshot: jsonb('address_snapshot').$type<Record<string, unknown>>(),
  remark: varchar('remark', { length: 200 }),
  /** miniapp | ai —— AI 助手代下单的订单单独统计转化 */
  source: varchar('source', { length: 10 }).notNull().default('miniapp'),
  /** 由哪次 AI 会话促成 */
  aiConversationId: integer('ai_conversation_id'),
  createdAt,
  updatedAt,
}, (t) => [index('idx_order_user').on(t.userId), index('idx_order_status').on(t.status)]);

export const orderItems = pgTable('order_item', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull(),
  skuId: integer('sku_id'),
  titleSnapshot: varchar('title_snapshot', { length: 120 }).notNull(),
  coverSnapshot: varchar('cover_snapshot', { length: 500 }),
  specSnapshot: varchar('spec_snapshot', { length: 80 }),
  priceCents: money('price_cents'),
  quantity: integer('quantity').notNull().default(1),
  /** none | pending | refunded | rejected */
  refundStatus: varchar('refund_status', { length: 20 }).notNull().default('none'),
  createdAt,
}, (t) => [index('idx_oitem_order').on(t.orderId)]);

export const payments = pgTable('payment', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 20 }).notNull(),
  amountCents: money('amount_cents'),
  /** pending | success | failed | refunded */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  tradeNo: varchar('trade_no', { length: 64 }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt,
});

export const afterSales = pgTable('after_sale', {
  id: serial('id').primaryKey(),
  afterSaleNo: varchar('after_sale_no', { length: 32 }).notNull().unique(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  orderItemId: integer('order_item_id').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** refund 仅退款 | return 退货退款 */
  type: varchar('type', { length: 10 }).notNull().default('refund'),
  reason: varchar('reason', { length: 60 }).notNull(),
  description: text('description'),
  images: jsonb('images').$type<string[]>().notNull().default([]),
  amountCents: money('amount_cents'),
  /** pending | approved | rejected | cancelled | refunded */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  auditRemark: varchar('audit_remark', { length: 200 }),
  auditedBy: integer('audited_by'),
  auditedAt: timestamp('audited_at', { withTimezone: true }),
  /** 由 AI 助手代提交的售后单，便于统计与追溯 */
  source: varchar('source', { length: 10 }).notNull().default('miniapp'),
  createdAt,
}, (t) => [index('idx_as_user').on(t.userId), index('idx_as_status').on(t.status)]);

export const walletLogs = pgTable('wallet_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** recharge | consume | refund */
  type: varchar('type', { length: 20 }).notNull(),
  /** 正数入账，负数出账 */
  amountCents: integer('amount_cents').notNull(),
  balanceAfter: money('balance_after'),
  refType: varchar('ref_type', { length: 20 }),
  refId: integer('ref_id'),
  remark: varchar('remark', { length: 200 }),
  createdAt,
}, (t) => [index('idx_wallet_user').on(t.userId)]);
