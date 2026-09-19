import { get, post, patch, del } from './http';

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const api = {
  login: (username: string, password: string) =>
    post<{ token: string; user: { id: number; nickname: string; role: string } }>('/auth/admin/login', { username, password }),

  dashboard: () =>
    get<{ kpi: Record<string, number>; trend: Record<string, unknown>[]; categorySales: unknown[]; payChannels: unknown[] }>('/admin/orders/dashboard'),

  aiStats: (days = 7) =>
    get<{
      totals: Record<string, number>;
      byTool: { toolName: string; calls: number; avgMs: number; errors: number; pendingCount: number }[];
      trend: unknown[];
      mode: { provider: string; model: string; mock: boolean; embedding: string };
      embeddingEnabled: boolean;
    }>('/admin/ai/stats', { days }),

  toolCalls: (params: Record<string, unknown>) => get<PageResult<Record<string, any>>>('/admin/ai/tool-calls', params),
  conversations: (params: Record<string, unknown>) => get<PageResult<Record<string, any>>>('/admin/ai/conversations', params),
  conversationDetail: (id: number) =>
    get<{ conversation: Record<string, any>; messages: Record<string, any>[]; toolCalls: Record<string, any>[]; pendingActions: Record<string, any>[] }>('/admin/ai/conversations/' + id),
  copywriting: (productId: number, style: string) =>
    post<{ title: string; subtitle: string; sellingPoints: string[]; description: string; tags: string[]; model: string }>('/admin/ai/copywriting', { productId, style }),
  insight: () => get<{ title: string; points: string[]; suggestion: string; model: string }>('/admin/ai/insight'),

  knowledgeList: (params: Record<string, unknown>) => get<PageResult<Record<string, any>>>('/admin/knowledge', params),
  knowledgeCreate: (body: Record<string, unknown>) => post('/admin/knowledge', body),
  knowledgeUpdate: (id: number, body: Record<string, unknown>) => patch('/admin/knowledge/' + id, body),
  knowledgeRemove: (id: number) => del('/admin/knowledge/' + id),
  reindex: () => post('/admin/knowledge/reindex'),

  products: (params: Record<string, unknown>) => get<PageResult<Record<string, any>>>('/admin/products', params),
  productStatus: (id: number, status: string) => post('/admin/products/' + id + '/status', { status }),
  categories: () => get<Record<string, any>[]>('/admin/categories'),

  orders: (params: Record<string, unknown>) => get<PageResult<Record<string, any>>>('/admin/orders', params),
  ship: (id: number) => post('/admin/orders/' + id + '/ship'),
  afterSales: (params: Record<string, unknown>) => get<PageResult<Record<string, any>>>('/admin/after-sales', params),
  auditAfterSale: (id: number, approve: boolean, remark: string) => post('/admin/after-sales/' + id + '/audit', { approve, remark }),

  users: (params: Record<string, unknown>) => get<PageResult<Record<string, any>>>('/admin/users', params),
  updateUser: (id: number, body: Record<string, unknown>) => patch('/admin/users/' + id, body),
  adjustBalance: (id: number, amountCents: number, remark: string) => post('/admin/users/' + id + '/balance', { amountCents, remark }),
};

export const yuan = (cents: number) => '¥' + ((cents ?? 0) / 100).toFixed(2);
export const STATUS_LABEL: Record<string, string> = {
  pending_pay: '待付款', paid: '待发货', shipped: '待收货', finished: '已完成',
  cancelled: '已取消', closed: '已关闭',
  pending: '待审核', approved: '已同意', rejected: '已拒绝', refunded: '已退款',
};
