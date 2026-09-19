const api = require('../../utils/api');
const { yuan } = require('../../utils/format');

Page({
  data: {
    id: 0,
    product: null,
    skus: [],
    skuIndex: 0,
    summary: null,
    reviews: [],
    priceText: '',
    quantity: 1,
    loading: true,
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    this.setData({ id });
    this.load();
  },

  async load() {
    try {
      const detail = await api.productDetail(this.data.id);
      const reviews = await api.reviews(this.data.id).catch(() => ({ list: [], summary: null }));
      const summary = reviews.summary || detail.reviewSummary || null;
      this.setData({
        product: detail,
        skus: detail.skus || [],
        priceText: yuan(detail.priceCents),
        summary,
        reviews: (reviews.list || []).slice(0, 3),
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  pickSku(e) {
    this.setData({ skuIndex: Number(e.detail.value) });
  },

  async addCart() {
    const sku = this.data.skus[this.data.skuIndex];
    await api.addCart(this.data.id, this.data.quantity, sku ? sku.id : undefined);
    wx.showToast({ title: '已加入购物车' });
  },

  async buyNow() {
    const sku = this.data.skus[this.data.skuIndex];
    await api.addCart(this.data.id, this.data.quantity, sku ? sku.id : undefined);
    wx.navigateTo({ url: '/pages/order/confirm' });
  },

  goCart() {
    wx.switchTab({ url: '/pages/cart/index' });
  },

  /** 带着商品上下文进 AI 助手，「这个辣不辣」这类问题才有指代 */
  askAi() {
    wx.setStorageSync('ai_page_context', { page: 'product', productId: this.data.id });
    wx.switchTab({
      url: '/pages/ai/chat',
      success: () => {
        const pages = getCurrentPages();
        const chat = pages[pages.length - 1];
        if (chat && chat.askQuick) chat.askQuick('这件商品值得买吗？还有货吗');
      },
    });
  },
});
