import { z } from 'zod';

/** 统一响应包装：{ code, message, data } */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 分页 */
export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 商品检索（AI 工具与前台共用同一套参数） */
export const ProductSearchQuery = z.object({
  keyword: z.string().trim().max(60).optional(),
  kind: z.enum(['snack', 'book']).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  /** 价格单位：元（库内统一存分，服务层负责换算） */
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  tags: z.array(z.string()).optional(),
  /** 二手书专用：成色 / 课程 / ISBN */
  condition: z.enum(['new', 'like_new', 'good', 'fair']).optional(),
  course: z.string().trim().max(60).optional(),
  isbn: z.string().trim().max(20).optional(),
  /** 排序：综合 / 销量 / 价格升降 / 最新 */
  sort: z.enum(['default', 'sales', 'price_asc', 'price_desc', 'newest']).default('default'),
  /** 语义检索开关：AI 导购会用，前台搜索默认关 */
  semantic: z.boolean().default(false),
}).merge(PaginationQuery);
export type ProductSearchQuery = z.infer<typeof ProductSearchQuery>;

/** AI 对话请求 */
export const ChatRequest = z.object({
  conversationId: z.coerce.number().int().positive().optional(),
  scene: z.enum(['shopping', 'support', 'merchant']).default('shopping'),
  message: z.string().trim().min(1).max(2000),
  /** 页面上下文：例如 { page: 'product', productId: 12 } —— 让「这个」有指代 */
  pageContext: z.record(z.string(), z.unknown()).optional(),
  /** 图片地址（拍照找同款） */
  imageUrls: z.array(z.string()).max(3).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/** 写操作二次确认 */
export const ConfirmActionRequest = z.object({
  actionId: z.coerce.number().int().positive(),
  decision: z.enum(['confirm', 'cancel']),
});
export type ConfirmActionRequest = z.infer<typeof ConfirmActionRequest>;
