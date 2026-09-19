const api = require('../../utils/api');
const { yuan } = require('../../utils/format');

Page({
  data: { user: null, balanceText: '¥0.00', aiMock: true, orderCounts: {} },

  onShow() {
    this.load();
  },

  async load() {
    await api.ensureLogin();
    const [user, wallet, status, orders] = await Promise.all([
      api.me(),
      api.wallet(),
      api.aiStatus(),
      api.orders('all'),
    ]);
    const counts = { pending_pay: 0, paid: 0, shipped: 0, finished: 0 };
    (orders || []).forEach((o) => {
      if (counts[o.status] !== undefined) counts[o.status] += 1;
    });
    this.setData({ user, balanceText: yuan(wallet.balanceCents), aiMock: status.mock, orderCounts: counts });
  },

  goOrders(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({ url: '/pages/order/list?status=' + status });
  },

  goAfterSale() {
    wx.navigateTo({ url: '/pages/after-sale/list' });
  },

  goAddress() {
    wx.navigateTo({ url: '/pages/address/list' });
  },

  async recharge() {
    const result = await new Promise((resolve) =>
      wx.showActionSheet({
        itemList: ['充值 20 元', '充值 50 元', '充值 100 元'],
        success: (r) => resolve([2000, 5000, 10000][r.tapIndex]),
        fail: () => resolve(0),
      }),
    );
    if (!result) return;
    await api.recharge(result);
    wx.showToast({ title: '充值成功' });
    this.load();
  },

  goAi() {
    wx.switchTab({ url: '/pages/ai/chat' });
  },

  logout() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
    wx.showToast({ title: '已退出登录' });
    setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
  },
});