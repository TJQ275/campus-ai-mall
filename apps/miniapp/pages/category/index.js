const api = require('../../utils/api');
const { decorateProduct } = require('../../utils/format');
const { showError, onImageError } = require('../../utils/ui');

Page({
  data: {
    kind: 'snack',
    categories: [],
    activeId: 0,
    list: [],
    page: 1,
    pageSize: 10,
    total: 0,
    loading: false,
    sort: 'default',
    errorText: '',
  },

  onLoad(options) {
    const kind = options.kind === 'book' ? 'book' : 'snack';
    this.setData({ kind });
    this.loadCategories();
    this.loadList(true);
  },

  switchKind(e) {
    const kind = e.currentTarget.dataset.kind;
    this.setData({ kind, activeId: 0, list: [], page: 1, total: 0 });
    this.loadCategories();
    this.loadList(true);
  },

  /**
   * 序列号：每次请求发一个号，回来时和最新的号对不上就整条丢弃。
   * 之前用的是 loading 布尔量，切分类时先清空列表再刷新，只要当时有请求在飞，
   * 这次刷新就被静默丢掉，页面永远停在「没有找到商品」。
   */
  bumpSeq(key) {
    this[key] = (this[key] || 0) + 1;
    return this[key];
  },

  async loadCategories() {
    const seq = this.bumpSeq('catSeq');
    try {
      const categories = await api.categories(this.data.kind);
      if (seq !== this.catSeq) return; // 又切了 kind，这次结果已经过期
      this.setData({ categories: categories || [] });
    } catch (err) {
      if (seq !== this.catSeq) return;
      showError(err, '分类加载失败');
    }
  },

  pickCategory(e) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    this.setData({ activeId: id, list: [], page: 1, total: 0 });
    this.loadList(true);
  },

  changeSort(e) {
    this.setData({ sort: e.currentTarget.dataset.sort, list: [], page: 1, total: 0 });
    this.loadList(true);
  },

  async loadList(reset) {
    // 上拉加载不重入（会重复追加）；切换条件的重新加载不能被丢掉，靠序列号丢弃过期响应
    if (!reset && this.data.loading) return;
    const seq = this.bumpSeq('listSeq');
    const query = {
      kind: this.data.kind,
      categoryId: this.data.activeId || undefined,
      sort: this.data.sort,
      page: reset ? 1 : this.data.page,
      pageSize: this.data.pageSize,
    };
    this.setData({ loading: true, errorText: '' });
    try {
      const result = await api.products(query);
      if (seq !== this.listSeq) return;
      const incoming = (result.list || []).map(decorateProduct);
      this.setData({
        list: reset ? incoming : this.data.list.concat(incoming),
        total: result.total || 0,
        page: (result.page || 1) + 1,
      });
    } catch (err) {
      if (seq !== this.listSeq) return;
      this.setData({ errorText: '商品加载失败，请下拉重试' });
      if (reset) this.setData({ list: [] });
      showError(err);
    } finally {
      if (seq === this.listSeq) this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.loading) return;
    if (this.data.list.length >= this.data.total) return;
    this.loadList(false);
  },

  onPullDownRefresh() {
    this.loadList(true).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.id });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  onImageError: onImageError,
});
