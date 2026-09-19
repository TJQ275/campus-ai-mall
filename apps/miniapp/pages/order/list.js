const api = require('../../utils/api');
const { yuan, orderStatus } = require('../../utils/format');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending_pay', label: '待付款' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'finished', label: '已完成' },
];

Page({
  data: { tabs: TABS, status: 'all', orders: [] },

  onLoad(options) {
    if (options.status) this.setData({ status: options.status });
  },

  onShow() {
    this.load();
  },

  switchTab(e) {
    this.setData({ status: e.currentTarget.dataset.key });
    this.load();
  },

  async load() {
    const orders = await api.orders(this.data.status);
    this.setData({
      orders: (orders || []).map((order) =>
        Object.assign({}, order, {
          statusText: orderStatus(order.status),
          payText: yuan(order.payCents),
          items: (order.items || []).map((i) => Object.assign({}, i, { priceText: yuan(i.priceCents) })),
        }),
      ),
    });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/order/detail?id=' + e.currentTarget.dataset.id });
  },

  async pay(e) {
    const id = e.currentTarget.dataset.id;
    const channel = await new Promise((resolve) =>
      wx.showActionSheet({ itemList: ['余额支付', '微信支付', '支付宝支付'], success: (r) => resolve(['balance', 'wechat', 'alipay'][r.tapIndex]) }),
    );
    await api.payOrder(id, channel);
    wx.showToast({ title: '支付成功' });
    this.load();
  },

  async cancel(e) {
    await api.cancelOrder(e.currentTarget.dataset.id);
    wx.showToast({ title: '已取消' });
    this.load();
  },

  async confirm(e) {
    await api.confirmOrder(e.currentTarget.dataset.id);
    wx.showToast({ title: '已确认收货' });
    this.load();
  },

  applyAfterSale(e) {
    const { orderid, itemid } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/after-sale/apply?orderItemId=' + itemid + '&orderId=' + orderid });
  },
});
