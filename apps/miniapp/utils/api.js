const { request, ensureLogin, logout } = require('./request');

const api = {
  ensureLogin,
  logout,

  // 商品
  home: (kind) => request({ url: '/home' + (kind ? '?kind=' + kind : '') }),
  categories: (kind) => request({ url: '/categories' + (kind ? '?kind=' + kind : ''), needAuth: false }),
  products: (query) => {
    const parts = [];
    Object.keys(query || {}).forEach((key) => {
      const value = query[key];
      if (value !== undefined && value !== null && value !== '') parts.push(key + '=' + encodeURIComponent(value));
    });
    return request({ url: '/products' + (parts.length ? '?' + parts.join('&') : ''), needAuth: false });
  },
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
  /** 订单分页：返回 { list, total, page, pageSize }，不再是裸数组 */
  orders: (status, page, pageSize) => {
    const parts = [];
    if (status && status !== 'all') parts.push('status=' + encodeURIComponent(status));
    if (page) parts.push('page=' + page);
    if (pageSize) parts.push('pageSize=' + pageSize);
    return request({ url: '/orders' + (parts.length ? '?' + parts.join('&') : '') });
  },
  /** 各状态订单数：一次聚合查询，替代拉全量订单在本地数 */
  orderSummary: () => request({ url: '/orders/summary' }),
  orderDetail: (id) => request({ url: '/orders/' + id }),
  payOrder: (id, channel) => request({ url: '/orders/' + id + '/pay', method: 'POST', data: { channel } }),
  cancelOrder: (id) => request({ url: '/orders/' + id + '/cancel', method: 'POST' }),
  confirmOrder: (id) => request({ url: '/orders/' + id + '/confirm', method: 'POST' }),

  // 售后
  applyAfterSale: (data) => request({ url: '/after-sales', method: 'POST', data }),
  afterSales: (status) => request({ url: '/after-sales' + (status ? '?status=' + status : '') }),
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
  aiChatSync: (data) => request({ url: '/ai/chat/sync', method: 'POST', data, header: { 'content-type': 'application/json' } }),
};

module.exports = api;
