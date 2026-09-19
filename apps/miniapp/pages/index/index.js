const api = require('../../utils/api');
const { decorateProduct, assetUrl } = require('../../utils/format');
const { showError, setCartBadge, onImageError } = require('../../utils/ui');

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
    this.load().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
      await api.ensureLogin();
      const home = await api.home();
      this.setData({
        banners: (home.banners || []).map((b) => Object.assign({}, b, { image: assetUrl(b.image) })),
        categories: (home.categories || []).slice(0, 10),
        recommend: (home.recommend || []).map(decorateProduct),
        hot: (home.hot || []).map(decorateProduct),
        recommendStrategy: home.recommendStrategy || '',
        greeting: home.greeting || '',
      });
    } catch (err) {
      showError(err, '首页加载失败，下拉重试');
    } finally {
      this.setData({ loading: false });
    }
  },

  async refreshCartBadge() {
    try {
      const cart = await api.cart();
      setCartBadge(cart.totalQuantity);
    } catch {
      /* 未登录/网络异常时角标不是关键路径，静默即可（request 层已经提示过） */
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

  onImageError: onImageError,
});
