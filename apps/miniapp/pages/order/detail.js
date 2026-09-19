const api = require('../../utils/api');
const { yuan, orderStatus, assetUrl } = require('../../utils/format');
const { showError, onImageError } = require('../../utils/ui');

Page({
  data: { order: null },

  onLoad(options) {
    this.id = Number(options.id || 0);
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const order = await api.orderDetail(this.id);
      this.setData({
        order: Object.assign({}, order, {
          statusText: orderStatus(order.status),
          payText: yuan(order.payCents),
          freightText: order.freightCents ? yuan(order.freightCents) : '免配送费',
          items: (order.items || []).map((i) => Object.assign({}, i, {
            priceText: yuan(i.priceCents),
            coverSnapshot: assetUrl(i.coverSnapshot),
          })),
        }),
      });
    } catch (err) {
      showError(err, '订单加载失败');
    }
  },

  async pay() {
    if (this.acting) return;
    this.acting = true;
    try {
      await api.payOrder(this.id, 'balance');
      wx.showToast({ title: '支付成功' });
      this.load();
    } catch (err) {
      showError(err, '支付失败');
    } finally {
      this.acting = false;
    }
  },

  async confirm() {
    if (this.acting) return;
    this.acting = true;
    try {
      await api.confirmOrder(this.id);
      wx.showToast({ title: '已确认收货' });
      this.load();
    } catch (err) {
      showError(err, '确认失败');
    } finally {
      this.acting = false;
    }
  },

  async cancel() {
    if (this.acting) return;
    this.acting = true;
    try {
      await api.cancelOrder(this.id);
      this.load();
    } catch (err) {
      showError(err, '取消失败');
    } finally {
      this.acting = false;
    }
  },

  applyAfterSale(e) {
    wx.navigateTo({ url: '/pages/after-sale/apply?orderItemId=' + e.currentTarget.dataset.itemid + '&orderId=' + this.id });
  },

  onImageError: onImageError,
});
