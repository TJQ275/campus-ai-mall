const { request, ensureLogin, logout, setupSession, getToken, getUser, getRole } = require('./request');

/** 拼查询串：自动跳过空值 */
function qs(params) {
  const parts = [];
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') parts.push(key + '=' + encodeURIComponent(value));
  });
  return parts.length ? '?' + parts.join('&') : '';
}

const api = {
  // 会话
  ensureLogin,
  logout,
  setupSession,
  getToken,
  getUser,
  getRole,

  // 登录（needAuth: false —— 登录本身当然不能要求先登录）
  wxLogin: (code, profile) =>
    request({ url: '/auth/wx/login', method: 'POST', data: Object.assign({ code }, profile || {}), needAuth: false }),
  adminLogin: (username, password) =>
    request({ url: '/auth/admin/login', method: 'POST', data: { username, password }, needAuth: false }),
  updateMe: (data) => request({ url: '/auth/me', method: 'PATCH', data }),
  uploadImage: (dataUrl) => request({ url: '/upload', method: 'POST', data: { dataUrl } }),

  // 商品
  home: (kind) => request({ url: '/home' + qs({ kind }) }),
  categories: (kind) => request({ url: '/categories' + qs({ kind }), needAuth: false }),
  products: (query) => request({ url: '/products' + qs(query), needAuth: false }),
  productDetail: (id) => request({ url: '/products/' + id }),
  reviews: (productId) => request({ url: '/products/' + productId + '/reviews', needAuth: false }),

  // 购物车
  cart: () => request({ url: '/cart' }),
  addCart: (productId, quantity, skuId) => request({ url: '/cart', method: 'POST', data: { productId, quantity, skuId } }),
  updateCart: (id, data) => request({ url: '/cart/' + id, method: 'PATCH', data }),
  removeCart: (id) => request({ url: '/cart/' + id, method: 'DELETE' }),

  // 订单
  orderPreview: () => request({ url: '/orders/preview' }),
  createOrder: (data) => request({ url: '/orders', method: 'POST', data }),
  orders: (status, page, pageSize) => request({ url: '/orders' + qs({ status: status === 'all' ? '' : status, page, pageSize }) }),
  orderSummary: () => request({ url: '/orders/summary' }),
  orderDetail: (id) => request({ url: '/orders/' + id }),
  payOrder: (id, channel) => request({ url: '/orders/' + id + '/pay', method: 'POST', data: { channel } }),
  cancelOrder: (id) => request({ url: '/orders/' + id + '/cancel', method: 'POST' }),
  confirmOrder: (id) => request({ url: '/orders/' + id + '/confirm', method: 'POST' }),

  // 售后
  applyAfterSale: (data) => request({ url: '/after-sales', method: 'POST', data }),
  afterSales: (status) => request({ url: '/after-sales' + qs({ status }) }),
  cancelAfterSale: (id) => request({ url: '/after-sales/' + id + '/cancel', method: 'POST' }),

  // 地址 / 钱包 / 我的
  addresses: () => request({ url: '/addresses' }),
  createAddress: (data) => request({ url: '/addresses', method: 'POST', data }),
  updateAddress: (id, data) => request({ url: '/addresses/' + id, method: 'PATCH', data }),
  removeAddress: (id) => request({ url: '/addresses/' + id, method: 'DELETE' }),
  wallet: () => request({ url: '/wallet' }),
  recharge: (amountCents) => request({ url: '/wallet/recharge', method: 'POST', data: { amountCents } }),
  me: () => request({ url: '/auth/me' }),

  // AI
  aiStatus: () => request({ url: '/ai/status' }),
  confirmAction: (actionId, decision) =>
    request({ url: '/ai/actions/' + actionId + '/confirm', method: 'POST', data: { decision } }),
  aiChatSync: (data) => request({ url: '/ai/chat/sync', method: 'POST', data }),

  // 商家端（手机值班用：看订单、发货、审售后）
  merchantOverview: () => request({ url: '/admin/orders/dashboard' }),
  merchantOrders: (params) => request({ url: '/admin/orders' + qs(params) }),
  merchantShip: (id) => request({ url: '/admin/orders/' + id + '/ship', method: 'POST' }),
  merchantAfterSales: (params) => request({ url: '/admin/after-sales' + qs(params) }),
  merchantAudit: (id, approve, remark) =>
    request({ url: '/admin/after-sales/' + id + '/audit', method: 'POST', data: { approve, remark } }),
  merchantAiStats: () => request({ url: '/admin/ai/stats' }),
  merchantLoginLogs: (params) => request({ url: '/admin/login-logs' + qs(params) }),
};

module.exports = api;
