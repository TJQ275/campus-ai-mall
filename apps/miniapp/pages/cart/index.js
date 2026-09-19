const api = require('../../utils/api');
const { yuan } = require('../../utils/format');

Page({
  data: { list: [], totalCents: 0, freightCents: 0, totalText: '¥0.00', freightText: '', selectedCount: 0 },

  onShow() {
    this.load();
  },

  async load() {
    const cart = await api.cart();
    this.setData({
      list: (cart.list || []).map((item) => Object.assign({}, item, { priceText: yuan(item.priceCents) })),
      totalCents: cart.totalCents,
      totalText: yuan(cart.totalCents),
      freightCents: cart.freightCents,
      freightText: cart.freightCents ? yuan(cart.freightCents) : '免配送费',
      selectedCount: cart.selectedCount,
    });
    if (cart.totalQuantity > 0) wx.setTabBarBadge({ index: 2, text: String(cart.totalQuantity) });
    else wx.removeTabBarBadge({ index: 2 });
  },

  async toggle(e) {
    const { id, index } = e.currentTarget.dataset;
    await api.updateCart(id, { selected: !this.data.list[index].selected });
    this.load();
  },

  async changeQty(e) {
    const { id, index, delta } = e.currentTarget.dataset;
    const quantity = Math.max(1, this.data.list[index].quantity + Number(delta));
    await api.updateCart(id, { quantity });
    this.load();
  },

  async remove(e) {
    const id = e.currentTarget.dataset.id;
    const confirm = await new Promise((resolve) =>
      wx.showModal({ title: '移出购物车？', success: (res) => resolve(res.confirm) }),
    );
    if (!confirm) return;
    await api.removeCart(id);
    this.load();
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.pid });
  },

  checkout() {
    if (!this.data.selectedCount) return wx.showToast({ title: '请先勾选商品', icon: 'none' });
    wx.navigateTo({ url: '/pages/order/confirm' });
  },

  goShopping() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});