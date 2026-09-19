const api = require('../../utils/api');

Page({
  data: { id: 0, receiver: '', phone: '', campus: '', detail: '', isDefault: false },

  onLoad(options) {
    if (!options.id) return;
    this.setData({ id: Number(options.id) });
    api.addresses().then((list) => {
      const hit = (list || []).find((a) => a.id === Number(options.id));
      if (hit) this.setData(hit);
    });
  },

  onField(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },

  toggleDefault() {
    this.setData({ isDefault: !this.data.isDefault });
  },

  async save() {
    const { id, receiver, phone, campus, detail, isDefault } = this.data;
    if (!receiver || !phone || !detail) return wx.showToast({ title: '请填写完整', icon: 'none' });
    const payload = { receiver, phone, campus, detail, isDefault };
    if (id) await api.updateAddress(id, payload);
    else await api.createAddress(payload);
    wx.showToast({ title: '已保存' });
    setTimeout(() => wx.navigateBack(), 600);
  },
});
