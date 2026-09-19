const api = require('../../utils/api');
const { yuan, assetUrl } = require('../../utils/format');
const { showError, onImageError } = require('../../utils/ui');

Page({
  data: {
    id: 0,
    product: null,
    skus: [],
    skuIndex: 0,
    summary: null,
    reviews: [],
    priceText: '',
    originalPriceText: '',
    skuPriceText: '',
    quantity: 1,
    loading: true,
  },

  onLoad(options) {
    const id = Number(options.id || 0);
    this.setData({ id });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const detail = await api.productDetail(this.data.id);
      const reviews = await api.reviews(this.data.id).catch(() => ({ list: [], summary: null }));
      const summary = reviews.summary || detail.reviewSummary || null;
      this.setData({
        product: Object.assign({}, detail, {
          // 详情图与封面都可能是 /uploads 相对路径；图对象化是为了能标记「这张加载失败」
          cover: assetUrl(detail.cover),
          images: (detail.images || []).map((url) => ({ url: assetUrl(url) })),
        }),
        skus: detail.skus || [],
        priceText: yuan(detail.priceCents),
        originalPriceText: yuan(detail.originalPriceCents),
        summary,
        reviews: (reviews.list || []).slice(0, 3),
      });
      this.refreshSkuPrice();
    } catch (err) {
      showError(err, '商品加载失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  pickSku(e) {
    this.setData({ skuIndex: Number(e.detail.value) });
    this.refreshSkuPrice();
  },

  refreshSkuPrice() {
    const sku = this.data.skus[this.data.skuIndex];
    this.setData({ skuPriceText: sku ? yuan(sku.priceCents) : '' });
  },

  async addCart() {
    if (this.adding) return;
    this.adding = true;
    try {
      const sku = this.data.skus[this.data.skuIndex];
      await api.addCart(this.data.id, this.data.quantity, sku ? sku.id : undefined);
      wx.showToast({ title: '已加入购物车' });
    } catch (err) {
      showError(err, '加入购物车失败');
    } finally {
      this.adding = false;
    }
  },

  async buyNow() {
    if (this.adding) return;
    this.adding = true;
    try {
      const sku = this.data.skus[this.data.skuIndex];
      await api.addCart(this.data.id, this.data.quantity, sku ? sku.id : undefined);
      wx.navigateTo({ url: '/pages/order/confirm' });
    } catch (err) {
      showError(err, '下单失败');
    } finally {
      this.adding = false;
    }
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

  onImageError: onImageError,
});
