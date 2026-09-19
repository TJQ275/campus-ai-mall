import { get, post, patch, put, del } from './http';
import {
  AFTER_SALE_STATUS_LABEL as SHARED_AFTER_SALE_STATUS_LABEL,
  ORDER_STATUS_LABEL as SHARED_ORDER_STATUS_LABEL,
  PAY_CHANNEL_LABEL as SHARED_PAY_CHANNEL_LABEL,
} from '@campus/shared';

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 列表类接口统一接受 AbortSignal，用于丢弃过期响应 */
type ListParams = object;

export interface DashboardData {
  kpi: Record<string, number>;
  trend: { day: string; orders: number; amount: number }[];
  categorySales: { name: string; qty: number }[];
  payChannels: { channel: string; count: number }[];
}

export interface AiStats {
  totals: Record<string, number>;
  byTool: { toolName: string; calls: number; avgMs: number; errors: number; pendingCount: number }[];
  trend: unknown[];
  mode: { provider: string; model: string; mock: boolean; embedding: string };
  embeddingEnabled: boolean;
  /** 向量检索健康度：配了模型但调用失败时 failing=true（正在静默降级到关键词检索） */
  embeddingHealth: {
    enabled: boolean;
    model: string | null;
    failing: boolean;
    lastError: string | null;
    lastErrorAt: string | null;
    hint: string | null;
  };
}

export interface AiBudget {
  budgetMicro: number;
  spentMicro: number;
  remainingMicro: number;
  overBudget: boolean;
  usedPercent: number;
}

export interface AiCost {
  days: number;
  totals: {
    calls: number; costMicro: number; costText: string;
    promptTokens: number; completionTokens: number;
    avgLatencyMs: number; degradedCalls: number; degradedRate: number;
    conversations: number; users: number; avgCostPerCallMicro: number;
  };
  budget: AiBudget;
  byDay: { day: string; calls: number; costMicro: number; costText: string }[];
  byModel: { model: string; calls: number; promptTokens: number; completionTokens: number; costMicro: number; costText: string }[];
  byScene: { scene: string; calls: number; costMicro: number; costText: string }[];
  byKind: { kind: string; calls: number; costMicro: number; costText: string }[];
  topUsers: { userId: number | null; nickname: string; calls: number; costMicro: number; costText: string }[];
  topConversations: { conversationId: number; calls: number; costMicro: number; costText: string }[];
}

export interface AiPriceRow {
  match: string; label: string;
  inputPerMillion: number; outputPerMillion: number;
  currency: 'CNY' | 'USD'; note?: string;
}

export const api = {
  login: (username: string, password: string) =>
    post<{ token: string; user: { id: number; nickname: string; role: string } }>('/auth/admin/login', { username, password }),

  dashboard: () => get<DashboardData>('/admin/orders/dashboard'),

  aiStats: (days = 7) => get<AiStats>('/admin/ai/stats', { days }),

  /** AI 成本看板：按天/模型/场景/用户聚合 + 预算状态 */
  aiCost: (days = 7) => get<AiCost>('/admin/ai/cost', { days }),
  aiPrices: () => get<{ version: string; usdToCny: number; items: AiPriceRow[] }>('/admin/ai/cost/prices'),
  aiBudget: () => get<AiBudget>('/admin/ai/budget'),
  /** 传元，后端换算成微元。0 = 不限额 */
  aiSetBudget: (dailyBudgetYuan: number) => put<AiBudget>('/admin/ai/budget', { dailyBudgetYuan }),

  toolCalls: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/ai/tool-calls', params, signal),
  conversations: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/ai/conversations', params, signal),
  conversationDetail: (id: number) =>
    get<{ conversation: Record<string, any>; messages: Record<string, any>[]; toolCalls: Record<string, any>[]; pendingActions: Record<string, any>[] }>('/admin/ai/conversations/' + id),
  copywriting: (productId: number, style: string) =>
    post<{ title: string; subtitle: string; sellingPoints: string[]; description: string; tags: string[]; model: string }>('/admin/ai/copywriting', { productId, style }),
  insight: () => get<{ title: string; points: string[]; suggestion: string; model: string }>('/admin/ai/insight'),

  knowledgeList: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/knowledge', params, signal),
  knowledgeCreate: (body: Record<string, unknown>) => post('/admin/knowledge', body),
  knowledgeUpdate: (id: number, body: Record<string, unknown>) => patch('/admin/knowledge/' + id, body),
  knowledgeRemove: (id: number) => del('/admin/knowledge/' + id),
  reindex: () => post('/admin/knowledge/reindex'),

  products: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/products', params, signal),
  productStatus: (id: number, status: string) => post('/admin/products/' + id + '/status', { status }),
  /** 新增 or 更新商品：带 id 即更新 */
  productSave: (body: Record<string, unknown>) => post<Record<string, any>>('/admin/products', body),
  loginLogs: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/login-logs', params, signal),
  productRemove: (id: number) => del<{ removed: boolean; id: number; title: string }>('/admin/products/' + id),
  categories: () => get<Record<string, any>[]>('/admin/categories'),

  /** 图片上传：小程序/后台都把图片读成 base64 传上来，返回可访问的 /uploads 路径 */
  upload: (dataUrl: string) => post<{ url: string; size: number }>('/upload', { dataUrl }),

  orders: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/orders', params, signal),
  ship: (id: number) => post('/admin/orders/' + id + '/ship'),
  afterSales: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/after-sales', params, signal),
  auditAfterSale: (id: number, approve: boolean, remark: string) => post('/admin/after-sales/' + id + '/audit', { approve, remark }),

  users: (params: ListParams, signal?: AbortSignal) => get<PageResult<Record<string, any>>>('/admin/users', params, signal),
  updateUser: (id: number, body: Record<string, unknown>) => patch('/admin/users/' + id, body),
  adjustBalance: (id: number, amountCents: number, remark: string) => post('/admin/users/' + id + '/balance', { amountCents, remark }),

  /** AI 设置：读当前大模型配置（Key 已脱敏） */
  llmSettings: () => get<LlmSettings>('/admin/settings/llm'),
  /** 保存大模型配置，保存后立即生效，不需要重启 */
  saveLlmSettings: (body: LlmSettingsInput) => put<LlmSettings>('/admin/settings/llm', body),
  /** 测试连接：用当前（或页面上填的）配置发一个最小请求 */
  testLlm: (body: LlmSettingsInput) =>
    post<{ ok: boolean; message: string; model?: string; latencyMs?: number }>('/admin/settings/llm/test', body),
  /** 恢复默认：清掉后台保存的配置，回到 .env */
  resetLlmSettings: () => post<LlmSettings>('/admin/settings/llm/reset'),
};

/** 大模型配置（服务端 describe() 的返回） */
export interface LlmSettings {
  baseUrl: string;
  model: string;
  visionModel: string;
  embeddingModel: string;
  embeddingDim: number;
  timeoutMs: number;
  apiKeyConfigured: boolean;
  /** 形如 sk-a****1234，只用于展示 */
  apiKeyMasked: string;
  /** 哪些字段被后台覆盖过（true 表示不来自 .env） */
  overridden: Record<string, boolean>;
  presets: { label: string; baseUrl: string; model: string; visionModel: string; embeddingModel: string }[];
  runtime: { provider: string; model: string; mock: boolean; baseUrl: string | null; embedding: string; configSource: string };
}

/** 保存 / 测试连接的入参；apiKey 留空表示不修改，填 'clear' 表示清空 */
export interface LlmSettingsInput {
  baseUrl?: string;
  model?: string;
  visionModel?: string;
  embeddingModel?: string;
  timeoutMs?: number;
  apiKey?: string;
}

export const yuan = (cents: number) => '¥' + ((cents ?? 0) / 100).toFixed(2);

// 状态标签统一来自 @campus/shared，前端不再各自维护一份（改口径只改共享包一处）
export const ORDER_STATUS_LABEL: Record<string, string> = SHARED_ORDER_STATUS_LABEL;
export const AFTER_SALE_STATUS_LABEL: Record<string, string> = SHARED_AFTER_SALE_STATUS_LABEL;
export const PAY_CHANNEL_LABEL: Record<string, string> = SHARED_PAY_CHANNEL_LABEL;