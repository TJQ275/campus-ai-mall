const api = require('../../utils/api');
const { yuan, afterSaleStatus } = require('../../utils/format');

Page({
  data: { list: [] },

  onShow() {
    this.load();
  },

  async load() {
    const list = await api.afterSales();
    this.setData({
      list: (list || []).map((item) =>
        Object.assign({}, item, { statusText: afterSaleStatus(item.status), amountText: yuan(item.amountCents) }),
      ),
    });
  },

  async cancel(e) {
    await api.cancelAfterSale(e.currentTarget.dataset.id);
    wx.showToast({ title: '已撤销' });
    this.load();
  },
});
