const api = require('../../utils/api');

Page({
  data: { list: [], pickMode: false },

  onLoad(options) {
    this.setData({ pickMode: options.pick === '1' });
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ list: (await api.addresses()) || [] });
  },

  edit(e) {
    wx.navigateTo({ url: '/pages/address/edit?id=' + e.currentTarget.dataset.id });
  },

  add() {
    wx.navigateTo({ url: '/pages/address/edit' });
  },

  async setDefault(e) {
    await api.updateAddress(e.currentTarget.dataset.id, { isDefault: true });
    wx.showToast({ title: '已设为默认' });
    this.load();
  },

  async remove(e) {
    const confirm = await new Promise((resolve) =>
      wx.showModal({ title: '删除该地址？', success: (res) => resolve(res.confirm) }),
    );
    if (!confirm) return;
    await api.removeAddress(e.currentTarget.dataset.id);
    this.load();
  },
});
