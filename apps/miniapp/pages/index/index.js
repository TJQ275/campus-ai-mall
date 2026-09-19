const api = require('../../utils/api');
const { decorateProduct } = require('../../utils/format');

Page({
  data: {
    banners: [],
    categories: [],
    recommend: [],
    hot: [],
    recommendStrategy: '',
    greeting: '',
    loading: true,
    quickAsks: ['想吃辣的，20 元以内', '有高数的教材吗', '退款多久到账'],
  },

  onLoad() {
    this.load();
  },

  onShow() {
    this.refreshCartBadge();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureLogin();
      const home = await api.home();
      this.setData({
        banners: home.banners || [],
        categories: (home.categories || []).slice(0, 10),
        recommend: (home.recommend || []).map(decorateProduct),
        hot: (home.hot || []).map(decorateProduct),
        recommendStrategy: home.recommendStrategy || '',
        greeting: home.greeting || '',
      });
    } catch (err) {
      /* request 层已经提示过 */
    } finally {
      this.setData({ loading: false });
    }
  },

  async refreshCartBadge() {
    try {
      const cart = await api.cart();
      if (cart.totalQuantity > 0) wx.setTabBarBadge({ index: 2, text: String(cart.totalQuantity) });
      else wx.removeTabBarBadge({ index: 2 });
    } catch (err) {
      /* 未登录时忽略 */
    }
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.id });
  },

  goCategoryList(e) {
    wx.navigateTo({ url: '/pages/category/index?kind=' + (e.currentTarget.dataset.kind || 'snack') });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  goAi(e) {
    const question = e.currentTarget.dataset.q || '';
    wx.switchTab({
      url: '/pages/ai/chat',
      success() {
        if (question) {
          const pages = getCurrentPages();
          const chat = pages[pages.length - 1];
          if (chat && chat.askQuick) chat.askQuick(question);
        }
      },
    });
  },
});