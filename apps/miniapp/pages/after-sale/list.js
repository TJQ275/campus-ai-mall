const api = require('../../utils/api');
const { yuan, afterSaleStatus } = require('../../utils/format');
const { showError } = require('../../utils/ui');

Page({
  data: { list: [], errorText: '' },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const list = await api.afterSales();
      this.setData({
        list: (list || []).map((item) =>
          Object.assign({}, item, { statusText: afterSaleStatus(item.status), amountText: yuan(item.amountCents) }),
        ),
        errorText: '',
      });
    } catch (err) {
      this.setData({ errorText: '售后记录加载失败' });
      showError(err);
    }
  },

  async cancel(e) {
    try {
      await api.cancelAfterSale(e.currentTarget.dataset.id);
      wx.showToast({ title: '已撤销' });
      this.load();
    } catch (err) {
      showError(err, '撤销失败');
    }
  },
});
