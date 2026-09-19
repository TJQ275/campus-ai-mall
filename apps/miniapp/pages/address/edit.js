const api = require('../../utils/api');
const { showError } = require('../../utils/ui');

/** 与后端一致：11 位手机号 */
const PHONE_RE = /^1[3-9]\d{9}$/;

Page({
  data: { id: 0, receiver: '', phone: '', campus: '', detail: '', isDefault: false },

  onLoad(options) {
    if (!options.id) return;
    this.setData({ id: Number(options.id) });
    this.load(Number(options.id));
  },

  async load(id) {
    try {
      const list = await api.addresses();
      const hit = (list || []).find((a) => a.id === id);
      // 只回填表单需要的字段：整行塞进 data 会把 userId 之类也带到提交体里
      if (hit) {
        this.setData({
          receiver: hit.receiver || '',
          phone: hit.phone || '',
          campus: hit.campus || '',
          detail: hit.detail || '',
          isDefault: Boolean(hit.isDefault),
        });
      }
    } catch (err) {
      showError(err, '地址加载失败');
    }
  },

  onField(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },

  /** switch 的值以事件为准：取反 this.data 会和用户实际点击的开关状态漂移 */
  toggleDefault(e) {
    this.setData({ isDefault: Boolean(e.detail.value) });
  },

  async save() {
    if (this.data.saving) return;
    const { id, receiver, phone, campus, detail, isDefault } = this.data;
    if (!receiver || !phone || !detail) return wx.showToast({ title: '请填写完整', icon: 'none' });
    if (!PHONE_RE.test(phone.trim())) return wx.showToast({ title: '请填写 11 位手机号', icon: 'none' });
    this.setData({ saving: true });
    try {
      const payload = { receiver, phone: phone.trim(), campus, detail, isDefault };
      if (id) await api.updateAddress(id, payload);
      else await api.createAddress(payload);
      wx.showToast({ title: '已保存' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      showError(err, '保存失败');
      this.setData({ saving: false });
    }
  },
});
