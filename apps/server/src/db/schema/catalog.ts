import { boolean, index, integer, jsonb, pgTable, primaryKey, real, serial, smallint, text, varchar, vector } from 'drizzle-orm/pg-core';
import { createdAt, EMBEDDING_DIM, money, updatedAt } from './_shared.js';
import { users } from './user.js';

/** 分类：kind 区分零食 / 二手书两条业务线 */
export const categories = pgTable('category', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 40 }).notNull(),
  slug: varchar('slug', { length: 40 }).notNull().unique(),
  /** snack | book */
  kind: varchar('kind', { length: 10 }).notNull(),
  parentId: integer('parent_id'),
  icon: varchar('icon', { length: 200 }),
  sort: integer('sort').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  createdAt,
}, (t) => [index('idx_category_kind').on(t.kind)]);

export const products = pgTable('product', {
  id: serial('id').primaryKey(),
  /** snack | book */
  kind: varchar('kind', { length: 10 }).notNull(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  title: varchar('title', { length: 120 }).notNull(),
  subtitle: varchar('subtitle', { length: 200 }),
  description: text('description'),
  cover: varchar('cover', { length: 500 }),
  images: jsonb('images').$type<string[]>().notNull().default([]),
  priceCents: money('price_cents'),
  originalPriceCents: money('original_price_cents'),
  stock: integer('stock').notNull().default(0),
  sales: integer('sales').notNull().default(0),
  /** draft | on | off */
  status: varchar('status', { length: 10 }).notNull().default('on'),
  /** 结构化标签：['辣', '膨化', '宿舍必备'] / ['高数', '考研', '有笔记'] */
  tags: jsonb('tags').$type<string[]>().notNull().default([]),

  // ── 零食属性 ──
  flavor: varchar('flavor', { length: 40 }),
  /** 辣度 0-5，AI 导购按「想吃辣的」直接过滤 */
  spicyLevel: smallint('spicy_level'),
  spec: varchar('spec', { length: 40 }),
  shelfLifeDays: integer('shelf_life_days'),

  // ── 二手书属性 ──
  isbn: varchar('isbn', { length: 20 }),
  author: varchar('author', { length: 80 }),
  publisher: varchar('publisher', { length: 80 }),
  edition: varchar('edition', { length: 40 }),
  /** 适用课程，如「高等数学（上）」 */
  course: varchar('course', { length: 80 }),
  /** new | like_new | good | fair */
  condition: varchar('condition', { length: 10 }),
  hasNotes: boolean('has_notes'),

  ratingAvg: real('rating_avg').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  viewCount: integer('view_count').notNull().default(0),
  /** 语义向量：标题+描述+标签拼接后嵌入，用于 RAG 与「找同款」 */
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
  createdAt,
  updatedAt,
}, (t) => [
  index('idx_product_kind').on(t.kind),
  index('idx_product_category').on(t.categoryId),
  index('idx_product_status').on(t.status),
]);

/** SKU：零食按规格，二手书按「具体副本」（库存通常为 1，成色各不相同） */
export const productSkus = pgTable('product_sku', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 60 }).notNull(),
  priceCents: money('price_cents'),
  stock: integer('stock').notNull().default(0),
  attrs: jsonb('attrs').$type<Record<string, unknown>>().notNull().default({}),
  /** 二手书副本：成色与卖家备注 */
  condition: varchar('condition', { length: 10 }),
  sellerNote: varchar('seller_note', { length: 200 }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt,
}, (t) => [index('idx_sku_product').on(t.productId)]);

/** 商品图 + 图片向量：拍照找同款的检索底库 */
export const productImages = pgTable('product_image', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  url: varchar('url', { length: 500 }).notNull(),
  /** cover | detail | user_upload */
  kind: varchar('kind', { length: 20 }).notNull().default('detail'),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
  createdAt,
}, (t) => [index('idx_pimage_product').on(t.productId)]);

/** 标签字典：让 AI 的检索条件结构化、可统计 */
export const tags = pgTable('tag', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 30 }).notNull().unique(),
  /** taste | scene | course | crowd | other */
  kind: varchar('kind', { length: 20 }).notNull().default('other'),
  weight: integer('weight').notNull().default(0),
  createdAt,
});

export const productTags = pgTable('product_tag', {
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.productId, t.tagId] })]);

export const reviews = pgTable('review', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orderItemId: integer('order_item_id'),
  rating: smallint('rating').notNull().default(5),
  content: text('content'),
  images: jsonb('images').$type<string[]>().notNull().default([]),
  /** 1 正常 0 隐藏 */
  status: smallint('status').notNull().default(1),
  createdAt,
}, (t) => [index('idx_review_product').on(t.productId)]);

/** AI 生成的评论摘要（异步任务写入，前台与导购工具直接读） */
export const reviewSummaries = pgTable('review_summary', {
  productId: integer('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  pros: jsonb('pros').$type<string[]>().notNull().default([]),
  cons: jsonb('cons').$type<string[]>().notNull().default([]),
  audience: varchar('audience', { length: 200 }),
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  ratingDist: jsonb('rating_dist').$type<Record<string, number>>().notNull().default({}),
  reviewCount: integer('review_count').notNull().default(0),
  model: varchar('model', { length: 60 }),
  updatedAt,
});
