const api = require('../../utils/api');
const { yuan, assetUrl } = require('../../utils/format');
const { showError, onImageError } = require('../../utils/ui');

Page({
  data: { user: null, balanceText: '¥0.00', aiMock: true, orderCounts: {} },

  onShow() {
    this.load();
  },

  async load() {
    try {
      await api.ensureLogin();
      const [user, wallet, status, summary] = await Promise.all([
        api.me(),
        api.wallet(),
        api.aiStatus(),
        // 角标只统计数量：以前是拉全量订单再在本地数，订单越多越慢
        api.orderSummary(),
      ]);
      this.setData({
        user: Object.assign({}, user, { avatar: assetUrl(user.avatar) }),
        balanceText: yuan(wallet.balanceCents),
        aiMock: status.mock,
        orderCounts: {
          pending_pay: summary.pending_pay || 0,
          paid: summary.paid || 0,
          shipped: summary.shipped || 0,
          finished: summary.finished || 0,
        },
      });
    } catch (err) {
      showError(err, '加载失败，请下拉重试');
    }
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
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
    const amount = await new Promise((resolve) =>
      wx.showActionSheet({
        itemList: ['充值 20 元', '充值 50 元', '充值 100 元'],
        success: (r) => resolve([2000, 5000, 10000][r.tapIndex]),
        fail: () => resolve(0),
      }),
    );
    if (!amount) return;
    try {
      await api.recharge(amount);
      wx.showToast({ title: '充值成功' });
      this.load();
    } catch (err) {
      showError(err, '充值失败');
    }
  },

  goAi() {
    wx.switchTab({ url: '/pages/ai/chat' });
  },

  /**
   * 小程序没有真正的「退出登录」：只要还在微信里，下次请求就会用同一个微信号静默登回来。
   * 所以这里只清本地登录态，提示语也不能说成「已退出」。
   */
  logout() {
    api.logout();
    wx.showToast({ title: '已清除登录状态', icon: 'none' });
    setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
  },

  onImageError: onImageError,
});
