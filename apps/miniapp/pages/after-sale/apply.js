const api = require('../../utils/api');
const { showError } = require('../../utils/ui');

const REASONS = ['不想要了', '商品破损', '与描述不符', '买重复了', '其他原因'];

Page({
  data: { reasons: REASONS, reasonIndex: 0, type: 'refund', description: '', submitting: false, orderItemId: 0 },

  onLoad(options) {
    this.setData({ orderItemId: Number(options.orderItemId || 0) });
  },

  pickReason(e) {
    this.setData({ reasonIndex: Number(e.detail.value) });
  },

  pickType(e) {
    this.setData({ type: e.currentTarget.dataset.type });
  },

  onDesc(e) {
    this.setData({ description: e.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      await api.applyAfterSale({
        orderItemId: this.data.orderItemId,
        type: this.data.type,
        reason: REASONS[this.data.reasonIndex],
        description: this.data.description,
      });
      wx.showToast({ title: '已提交，等待审核' });
      setTimeout(() => wx.redirectTo({ url: '/pages/after-sale/list' }), 700);
    } catch (err) {
      showError(err, '提交失败');
      this.setData({ submitting: false });
    }
  },
});
