const api = require('../../utils/api');
const { yuan, orderStatus, assetUrl } = require('../../utils/format');
const { showError, onImageError } = require('../../utils/ui');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending_pay', label: '待付款' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'finished', label: '已完成' },
];

const PAGE_SIZE = 10;

Page({
  data: {
    tabs: TABS, status: 'all', orders: [], total: 0, page: 1, loading: false, errorText: '',
  },

  onLoad(options) {
    if (options.status) this.setData({ status: options.status });
  },

  onShow() {
    this.load(true);
  },

  switchTab(e) {
    this.setData({ status: e.currentTarget.dataset.key });
    this.load(true);
  },

  bumpSeq() {
    this.seq = (this.seq || 0) + 1;
    return this.seq;
  },

  /** reset=true 拉第一页（切 tab / 进页面），false 追加下一页 */
  async load(reset) {
    // 上拉加载不允许重入（会重复追加同一页），切 tab 的重新加载不能被丢掉
    if (!reset && this.data.loading) return;
    const seq = this.bumpSeq();
    const status = this.data.status;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true, errorText: '' });
    try {
      const result = await api.orders(status, page, PAGE_SIZE);
      if (seq !== this.seq) return; // 期间又切了 tab，过期响应直接丢弃
      const incoming = this.formatOrders(result.list || []);
      const orders = reset ? incoming : this.data.orders.concat(incoming);
      this.setData({ orders, total: result.total || 0, page: page + 1 });
    } catch (err) {
      if (seq !== this.seq) return;
      // 失败要说清楚，否则和「没有订单」长得一样
      this.setData({ errorText: '订单加载失败，请下拉重试' });
      if (reset) this.setData({ orders: [] });
      showError(err);
    } finally {
      if (seq === this.seq) this.setData({ loading: false });
    }
  },

  formatOrders(list) {
    return list.map((order) =>
      Object.assign({}, order, {
        statusText: orderStatus(order.status),
        payText: yuan(order.payCents),
        items: (order.items || []).map((i) => Object.assign({}, i, {
          priceText: yuan(i.priceCents),
          coverSnapshot: assetUrl(i.coverSnapshot),
        })),
      }),
    );
  },

  onReachBottom() {
    if (this.data.loading) return;
    if (this.data.orders.length >= this.data.total) return;
    this.load(false);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/order/detail?id=' + e.currentTarget.dataset.id });
  },

  async pay(e) {
    const id = e.currentTarget.dataset.id;
    const channel = await new Promise((resolve) =>
      wx.showActionSheet({
        itemList: ['余额支付', '微信支付', '支付宝支付'],
        success: (r) => resolve(['balance', 'wechat', 'alipay'][r.tapIndex]),
        // 点「取消」走的是 fail：这里必须给 Promise 一个了结，否则整条支付流程卡死
        fail: () => resolve(''),
      }),
    );
    if (!channel) return;
    try {
      await api.payOrder(id, channel);
      wx.showToast({ title: '支付成功' });
      this.load(true);
    } catch (err) {
      showError(err, '支付失败');
    }
  },

  async cancel(e) {
    try {
      await api.cancelOrder(e.currentTarget.dataset.id);
      wx.showToast({ title: '已取消' });
      this.load(true);
    } catch (err) {
      showError(err, '取消失败');
    }
  },

  async confirm(e) {
    try {
      await api.confirmOrder(e.currentTarget.dataset.id);
      wx.showToast({ title: '已确认收货' });
      this.load(true);
    } catch (err) {
      showError(err, '确认失败');
    }
  },

  applyAfterSale(e) {
    const { orderid, itemid } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/after-sale/apply?orderItemId=' + itemid + '&orderId=' + orderid });
  },

  onImageError: onImageError,
});
