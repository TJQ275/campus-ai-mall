const api = require('../../utils/api');
const { yuan, orderStatus } = require('../../utils/format');

Page({
  data: { order: null },

  onLoad(options) {
    this.id = Number(options.id || 0);
  },

  onShow() {
    this.load();
  },

  async load() {
    const order = await api.orderDetail(this.id);
    this.setData({
      order: Object.assign({}, order, {
        statusText: orderStatus(order.status),
        payText: yuan(order.payCents),
        freightText: order.freightCents ? yuan(order.freightCents) : '免配送费',
        items: (order.items || []).map((i) => Object.assign({}, i, { priceText: yuan(i.priceCents) })),
      }),
    });
  },

  async pay() {
    await api.payOrder(this.id, 'balance');
    wx.showToast({ title: '支付成功' });
    this.load();
  },

  async confirm() {
    await api.confirmOrder(this.id);
    wx.showToast({ title: '已确认收货' });
    this.load();
  },

  async cancel() {
    await api.cancelOrder(this.id);
    this.load();
  },

  applyAfterSale(e) {
    wx.navigateTo({ url: '/pages/after-sale/apply?orderItemId=' + e.currentTarget.dataset.itemid + '&orderId=' + this.id });
  },
});
