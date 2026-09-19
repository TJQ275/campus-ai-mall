import { boolean, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, varchar, vector } from 'drizzle-orm/pg-core';
import { createdAt, EMBEDDING_DIM, updatedAt } from './_shared.js';
import { users } from './user.js';

export const aiConversations = pgTable('ai_conversation', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** shopping 导购 | support 客服售后 | merchant 商家运营 */
  scene: varchar('scene', { length: 20 }).notNull().default('shopping'),
  title: varchar('title', { length: 80 }),
  /** 进入会话时的页面上下文，例如 { page: 'product', productId: 12 } */
  pageContext: jsonb('page_context').$type<Record<string, unknown>>(),
  messageCount: integer('message_count').notNull().default(0),
  /** 超长会话的滚动摘要，控制 prompt 体积 */
  rollingSummary: text('rolling_summary'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt,
  updatedAt,
}, (t) => [index('idx_aiconv_user').on(t.userId)]);

export const aiMessages = pgTable('ai_message', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull(),
  /** system | user | assistant | tool */
  role: varchar('role', { length: 20 }).notNull(),
  /** text | cards | image | action */
  contentType: varchar('content_type', { length: 20 }).notNull().default('text'),
  content: text('content'),
  /** 助手回复里附带的商品卡片（后端按工具结果渲染，模型不产生价格） */
  cards: jsonb('cards').$type<Record<string, unknown>[]>().notNull().default([]),
  attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
  toolCallId: varchar('tool_call_id', { length: 64 }),
  toolName: varchar('tool_name', { length: 60 }),
  model: varchar('model', { length: 60 }),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  latencyMs: integer('latency_ms').notNull().default(0),
  /** 无 Key 降级 / 模型报错时的标记 */
  degraded: boolean('degraded').notNull().default(false),
  error: text('error'),
  createdAt,
}, (t) => [index('idx_aimsg_conv').on(t.conversationId)]);

/** 工具调用审计：管理后台「AI 调用日志」页面直接读这张表，答辩可回放 */
export const aiToolCalls = pgTable('ai_tool_call', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id'),
  messageId: integer('message_id'),
  userId: integer('user_id'),
  toolName: varchar('tool_name', { length: 60 }).notNull(),
  args: jsonb('args').$type<Record<string, unknown>>(),
  result: jsonb('result').$type<Record<string, unknown>>(),
  /** ok | error | denied */
  status: varchar('status', { length: 20 }).notNull().default('ok'),
  error: text('error'),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt,
}, (t) => [index('idx_aitool_conv').on(t.conversationId), index('idx_aitool_name').on(t.toolName)]);

/** 写操作待确认：AI 想加购/退款时先落这里，用户点确认才执行 */
export const aiPendingActions = pgTable('ai_pending_action', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  userId: integer('user_id').notNull(),
  /** add_to_cart | update_cart_item | create_order | apply_after_sale */
  actionType: varchar('action_type', { length: 40 }).notNull(),
  /** 给用户看的摘要：加购 2 件卫龙辣条，共 ¥8.00 */
  summary: varchar('summary', { length: 200 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  /** pending | confirmed | cancelled | expired | failed */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  resultMessage: text('result_message'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt,
}, (t) => [index('idx_aiact_user').on(t.userId), index('idx_aiact_status').on(t.status)]);

/** 知识库：售后政策、配送说明、FAQ —— 客服 RAG 的检索源 */
export const aiKnowledge = pgTable('ai_knowledge', {
  id: serial('id').primaryKey(),
  /** support | shopping | merchant | global */
  scene: varchar('scene', { length: 20 }).notNull().default('global'),
  title: varchar('title', { length: 120 }).notNull(),
  /** 来源标识：policy/refund.md#3 之类，回答时作为引用出处 */
  source: varchar('source', { length: 120 }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt,
}, (t) => [index('idx_aiknow_scene').on(t.scene)]);

export const aiFeedbacks = pgTable('ai_feedback', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id').notNull(),
  userId: integer('user_id').notNull(),
  /** 1 有用 -1 没用 */
  rating: smallint('rating').notNull(),
  comment: varchar('comment', { length: 300 }),
  createdAt,
});


/**
 * 用量与费用明细：**每一次**模型调用都记一条。
 *
 * 为什么不能只靠 ai_message 上的 prompt_tokens：
 * 一次对话可能调用模型多轮（工具回灌后再问一遍），而 ai_message 只在**最终回复**上落了 token，
 * 中间几轮的消耗全丢了 —— 工具调用越多，账差得越离谱。
 * 这张表按「调用」粒度记录，账才对得上。
 */
export const aiUsage = pgTable('ai_usage', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  conversationId: integer('conversation_id'),
  /** shopping | support | merchant | admin | eval */
  scene: varchar('scene', { length: 20 }),
  model: varchar('model', { length: 60 }).notNull(),
  /** chat 对话 | embedding 向量 | vision 识图 | test 连通性测试 */
  kind: varchar('kind', { length: 20 }).notNull().default('chat'),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  /** 费用，单位微元（1 元 = 1_000_000）—— 整数存储，避免浮点累积误差 */
  costMicro: integer('cost_micro').notNull().default(0),
  latencyMs: integer('latency_ms').notNull().default(0),
  /** 降级到 MockProvider 的调用不计费，但要能看出来 */
  degraded: boolean('degraded').notNull().default(false),
  /** 计价时用的价目表版本，改价后历史账单仍可对账 */
  priceVersion: varchar('price_version', { length: 20 }),
  createdAt,
}, (t) => [
  index('idx_aiusage_user').on(t.userId),
  index('idx_aiusage_conv').on(t.conversationId),
  index('idx_aiusage_created').on(t.createdAt),
  index('idx_aiusage_model').on(t.model),
]);
