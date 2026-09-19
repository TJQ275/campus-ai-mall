const api = require('../../utils/api');
const { yuan, assetUrl } = require('../../utils/format');
const { showError, setCartBadge, onImageError } = require('../../utils/ui');

/** 后端对单个商品的购买数量上限 */
const MAX_QUANTITY = 99;

Page({
  data: { list: [], totalCents: 0, freightCents: 0, totalText: '¥0.00', freightText: '', selectedCount: 0 },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const cart = await api.cart();
      this.setData({
        list: (cart.list || []).map((item) => Object.assign({}, item, {
          priceText: yuan(item.priceCents),
          cover: assetUrl(item.cover),
        })),
        totalCents: cart.totalCents,
        totalText: yuan(cart.totalCents),
        freightCents: cart.freightCents,
        freightText: cart.freightCents ? yuan(cart.freightCents) : '免配送费',
        selectedCount: cart.selectedCount,
      });
      setCartBadge(cart.totalQuantity);
    } catch (err) {
      showError(err, '购物车加载失败');
    }
  },

  /** 购物车条目的定位一律用 dataset 里的条目 id —— 下标在并发更新/列表重排后并不可靠 */
  findItem(id) {
    const target = Number(id);
    return (this.data.list || []).find((item) => item.id === target) || null;
  },

  async toggle(e) {
    const item = this.findItem(e.currentTarget.dataset.id);
    if (!item) return;
    try {
      await api.updateCart(item.id, { selected: !item.selected });
      this.load();
    } catch (err) {
      showError(err, '操作失败');
    }
  },

  async changeQty(e) {
    const item = this.findItem(e.currentTarget.dataset.id);
    if (!item) return;
    const quantity = item.quantity + Number(e.currentTarget.dataset.delta);
    if (quantity > MAX_QUANTITY) {
      wx.showToast({ title: '单件商品最多 ' + MAX_QUANTITY + ' 件', icon: 'none' });
      return;
    }
    if (quantity < 1) return;
    try {
      await api.updateCart(item.id, { quantity });
      this.load();
    } catch (err) {
      showError(err, '修改数量失败');
    }
  },

  async remove(e) {
    const id = e.currentTarget.dataset.id;
    const confirm = await new Promise((resolve) =>
      wx.showModal({
        title: '移出购物车？',
        success: (res) => resolve(res.confirm),
        // 点「取消」/ 关掉弹窗走的是 fail：不给 Promise 了结的话后面永远不执行
        fail: () => resolve(false),
      }),
    );
    if (!confirm) return;
    try {
      await api.removeCart(id);
      this.load();
    } catch (err) {
      showError(err, '删除失败');
    }
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

  onImageError: onImageError,
});
