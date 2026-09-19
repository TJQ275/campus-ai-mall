const api = require('../../utils/api');
const { showError } = require('../../utils/ui');

Page({
  data: { list: [], pickMode: false },

  onLoad(options) {
    this.setData({ pickMode: options.pick === '1' });
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      this.setData({ list: (await api.addresses()) || [] });
    } catch (err) {
      showError(err, '地址加载失败');
    }
  },

  /**
   * 下单页选地址：把选中的地址回传给结算页，而不是让结算页每次 onShow 都退回服务端默认地址。
   */
  pick(e) {
    if (!this.data.pickMode) return;
    const id = Number(e.currentTarget.dataset.id);
    const address = (this.data.list || []).find((item) => item.id === id);
    if (!address) return;
    const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (channel && channel.emit) {
      channel.emit('pickAddress', address);
    } else {
      // 兜底：拿不到 eventChannel 时直接写回上一个页面
      const pages = getCurrentPages();
      const prev = pages[pages.length - 2];
      if (prev && prev.applyPickedAddress) prev.applyPickedAddress(address);
    }
    wx.navigateBack();
  },

  edit(e) {
    wx.navigateTo({ url: '/pages/address/edit?id=' + e.currentTarget.dataset.id });
  },

  add() {
    wx.navigateTo({ url: '/pages/address/edit' });
  },

  async setDefault(e) {
    try {
      await api.updateAddress(e.currentTarget.dataset.id, { isDefault: true });
      wx.showToast({ title: '已设为默认' });
      this.load();
    } catch (err) {
      showError(err, '设置失败');
    }
  },

  async remove(e) {
    const confirm = await new Promise((resolve) =>
      wx.showModal({
        title: '删除该地址？',
        success: (res) => resolve(res.confirm),
        // 取消/关闭弹窗走 fail，必须给了结
        fail: () => resolve(false),
      }),
    );
    if (!confirm) return;
    try {
      await api.removeAddress(e.currentTarget.dataset.id);
      this.load();
    } catch (err) {
      showError(err, '删除失败');
    }
  },
});
