/** 商品品类：零食 / 二手书 */
export const ProductKind = {
  SNACK: 'snack',
  BOOK: 'book',
} as const;
export type ProductKind = (typeof ProductKind)[keyof typeof ProductKind];
export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  snack: '零食',
  book: '二手书',
};

/** 商品状态 */
export const ProductStatus = {
  DRAFT: 'draft',
  ON: 'on',
  OFF: 'off',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

/** 二手书成色 */
export const BookCondition = {
  NEW: 'new',
  LIKE_NEW: 'like_new',
  GOOD: 'good',
  FAIR: 'fair',
} as const;
export type BookCondition = (typeof BookCondition)[keyof typeof BookCondition];
export const BOOK_CONDITION_LABEL: Record<BookCondition, string> = {
  new: '全新未拆',
  like_new: '九成新',
  good: '七成新',
  fair: '五成新',
};

/** 订单状态 */
export const OrderStatus = {
  PENDING_PAY: 'pending_pay',
  PAID: 'paid',
  SHIPPED: 'shipped',
  FINISHED: 'finished',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_pay: '待付款',
  paid: '待发货',
  shipped: '待收货',
  finished: '已完成',
  cancelled: '已取消',
  closed: '已关闭',
};

/** 支付渠道（校园项目默认模拟支付） */
export const PayChannel = {
  WECHAT: 'wechat',
  ALIPAY: 'alipay',
  BALANCE: 'balance',
} as const;
export type PayChannel = (typeof PayChannel)[keyof typeof PayChannel];
/** 统计口径里的「未支付」占位，不属于 PayChannel */
export const PAY_CHANNEL_LABEL: Record<PayChannel | 'unpaid', string> = {
  wechat: '微信',
  alipay: '支付宝',
  balance: '余额',
  unpaid: '未支付',
};

/** 售后类型与状态 */
export const AfterSaleType = { REFUND: 'refund', RETURN: 'return' } as const;
export type AfterSaleType = (typeof AfterSaleType)[keyof typeof AfterSaleType];
export const AfterSaleStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;
export type AfterSaleStatus = (typeof AfterSaleStatus)[keyof typeof AfterSaleStatus];
export const AFTER_SALE_STATUS_LABEL: Record<AfterSaleStatus, string> = {
  pending: '待审核',
  approved: '已同意',
  rejected: '已拒绝',
  cancelled: '已撤销',
  refunded: '已退款',
};

/** AI 会话场景 */
export const AiScene = {
  SHOPPING: 'shopping',
  SUPPORT: 'support',
  MERCHANT: 'merchant',
} as const;
export type AiScene = (typeof AiScene)[keyof typeof AiScene];

/** 订单来源：普通下单 / AI 助手代下单 —— 用于统计 AI 转化 */
export const OrderSource = { MINIAPP: 'miniapp', AI: 'ai' } as const;
export type OrderSource = (typeof OrderSource)[keyof typeof OrderSource];

/** 用户行为类型（推荐算法 + 画像用） */
export const BehaviorType = {
  VIEW: 'view',
  SEARCH: 'search',
  CART: 'cart',
  ORDER: 'order',
  FAVORITE: 'favorite',
  CHAT: 'chat',
} as const;
export type BehaviorType = (typeof BehaviorType)[keyof typeof BehaviorType];