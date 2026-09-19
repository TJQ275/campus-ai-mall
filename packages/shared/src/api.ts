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

// ────────── 以下 schema 供服务端 ZodValidationPipe 使用，前后端共用同一份规则 ──────────

/** 管理端登录 */
export const AdminLoginRequest = z.object({
  username: z.string().trim().min(2, '账号至少 2 个字符').max(50),
  password: z.string().min(6, '密码至少 6 位').max(100),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequest>;

/** 小程序登录 */
export const WxLoginRequest = z.object({
  code: z.string().trim().min(1).max(200),
  nickname: z.string().trim().max(50).optional(),
  avatar: z.string().trim().max(500).optional(),
});
export type WxLoginRequest = z.infer<typeof WxLoginRequest>;

/** 加入购物车 */
export const AddCartRequest = z.object({
  productId: z.coerce.number().int().positive(),
  skuId: z.coerce.number().int().positive().optional(),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
  source: z.enum(['miniapp', 'ai']).default('miniapp'),
});
export type AddCartRequest = z.infer<typeof AddCartRequest>;

/** 修改购物车条目 */
export const UpdateCartRequest = z.object({
  quantity: z.coerce.number().int().min(1).max(99).optional(),
  selected: z.boolean().optional(),
});
export type UpdateCartRequest = z.infer<typeof UpdateCartRequest>;

/** 创建订单 */
export const CreateOrderRequest = z.object({
  addressId: z.coerce.number().int().positive(),
  remark: z.string().trim().max(200).optional(),
  source: z.enum(['miniapp', 'ai']).default('miniapp'),
  conversationId: z.coerce.number().int().positive().optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

/** 支付 */
export const PayOrderRequest = z.object({
  channel: z.enum(['wechat', 'alipay', 'balance']).default('wechat'),
});
export type PayOrderRequest = z.infer<typeof PayOrderRequest>;

/** 收货地址 */
export const AddressRequest = z.object({
  receiver: z.string().trim().min(1, '请填写收货人').max(50),
  phone: z.string().trim().regex(/^1[3-9]\d{9}$/, '请填写 11 位手机号'),
  campus: z.string().trim().max(60).optional(),
  detail: z.string().trim().min(1, '请填写详细地址').max(200),
  isDefault: z.boolean().default(false),
});
export type AddressRequest = z.infer<typeof AddressRequest>;

/** 申请售后 */
export const ApplyAfterSaleRequest = z.object({
  orderItemId: z.coerce.number().int().positive(),
  type: z.enum(['refund', 'return']).default('refund'),
  reason: z.string().trim().min(2, '请填写退款原因').max(60),
  description: z.string().trim().max(500).optional(),
  images: z.array(z.string().max(500)).max(9).optional(),
  source: z.enum(['miniapp', 'ai']).default('miniapp'),
});
export type ApplyAfterSaleRequest = z.infer<typeof ApplyAfterSaleRequest>;

/** 钱包充值（单位：分） */
export const RechargeRequest = z.object({
  amountCents: z.coerce.number().int().min(1).max(100000),
  channel: z.enum(['wechat', 'alipay']).default('wechat'),
});
export type RechargeRequest = z.infer<typeof RechargeRequest>;

/** 商品评价 */
export const ReviewRequest = z.object({
  productId: z.coerce.number().int().positive(),
  /** 关联的订单商品（校验是否真的买过），可不传 */
  orderItemId: z.coerce.number().int().positive().optional(),
  rating: z.coerce.number().int().min(1).max(5),
  content: z.string().trim().max(500).optional(),
  images: z.array(z.string().max(500)).max(9).optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

/** 图片上传（base64 dataUrl） */
export const UploadRequest = z.object({
  dataUrl: z.string().min(30).max(9_000_000),
  filename: z.string().max(120).optional(),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

/** 管理端：商品保存 */
export const AdminProductSaveRequest = z.object({
  id: z.coerce.number().int().positive().optional(),
  kind: z.enum(['snack', 'book']),
  title: z.string().trim().min(1, '商品标题不能为空').max(120),
  subtitle: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  cover: z.string().trim().max(500).optional(),
  images: z.array(z.string().max(500)).max(9).optional(),
  categoryId: z.coerce.number().int().positive(),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  originalPriceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  stock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  status: z.enum(['draft', 'on', 'off']).default('on'),
  tags: z.array(z.string().trim().max(20)).max(12).optional(),
  // 零食
  flavor: z.string().trim().max(40).optional(),
  spicyLevel: z.coerce.number().int().min(0).max(5).optional(),
  spec: z.string().trim().max(40).optional(),
  shelfLifeDays: z.coerce.number().int().min(0).max(3650).optional(),
  // 二手书
  isbn: z.string().trim().max(20).optional(),
  author: z.string().trim().max(80).optional(),
  publisher: z.string().trim().max(80).optional(),
  edition: z.string().trim().max(40).optional(),
  course: z.string().trim().max(80).optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair']).optional(),
  hasNotes: z.boolean().optional(),
});
export type AdminProductSaveRequest = z.infer<typeof AdminProductSaveRequest>;

/** 管理端：知识库条目 */
export const AdminKnowledgeRequest = z.object({
  scene: z.enum(['shopping', 'support', 'merchant']).default('support'),
  title: z.string().trim().min(1, '标题不能为空').max(120),
  source: z.string().trim().max(120).optional(),
  content: z.string().trim().min(1, '内容不能为空').max(10000),
  enabled: z.boolean().optional(),
});
export type AdminKnowledgeRequest = z.infer<typeof AdminKnowledgeRequest>;
