const api = require('../../utils/api');
const { decorateProduct } = require('../../utils/format');

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
  },

  onLoad(options) {
    const kind = options.kind === 'book' ? 'book' : 'snack';
    this.setData({ kind });
    this.loadCategories();
    this.loadList(true);
  },

  switchKind(e) {
    const kind = e.currentTarget.dataset.kind;
    this.setData({ kind, activeId: 0, list: [], page: 1 });
    this.loadCategories();
    this.loadList(true);
  },

  async loadCategories() {
    const categories = await api.categories(this.data.kind);
    this.setData({ categories });
  },

  pickCategory(e) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    this.setData({ activeId: id, list: [], page: 1 });
    this.loadList(true);
  },

  changeSort(e) {
    this.setData({ sort: e.currentTarget.dataset.sort, list: [], page: 1 });
    this.loadList(true);
  },

  async loadList(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const result = await api.products({
        kind: this.data.kind,
        categoryId: this.data.activeId || undefined,
        sort: this.data.sort,
        page: reset ? 1 : this.data.page,
        pageSize: this.data.pageSize,
      });
      const incoming = (result.list || []).map(decorateProduct);
      this.setData({
        list: reset ? incoming : this.data.list.concat(incoming),
        total: result.total,
        page: result.page + 1,
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.list.length < this.data.total) this.loadList(false);
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.id });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },
});
