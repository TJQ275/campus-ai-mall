const api = require('../../utils/api');
const { decorateProduct } = require('../../utils/format');

Page({
  data: { keyword: '', list: [], searched: false, loading: false, hotWords: ['辣条', '薯片', '高等数学', '数据结构', '考研'] },

  onLoad(options) {
    if (options.keyword) {
      this.setData({ keyword: options.keyword });
      this.search();
    }
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  pickWord(e) {
    this.setData({ keyword: e.currentTarget.dataset.word });
    this.search();
  },

  async search() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) return;
    this.setData({ loading: true });
    try {
      const result = await api.products({ keyword, pageSize: 20 });
      this.setData({ list: (result.list || []).map(decorateProduct), searched: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 扫码找书：书背 ISBN 条码 → 后端精确匹配（不依赖任何模型） */
  scan() {
    wx.scanCode({
      scanType: ['barCode'],
      success: async (res) => {
        const isbn = (res.result || '').replace(/[^0-9Xx]/g, '');
        if (!isbn) return wx.showToast({ title: '没识别到 ISBN', icon: 'none' });
        this.setData({ loading: true });
        try {
          const result = await api.products({ isbn, pageSize: 10 });
          if (!result.total) {
            wx.showModal({
              title: '没有这本书',
              content: 'ISBN ' + isbn + ' 暂时没有在售的二手教材，可以去 AI 助手那里登记求购。',
              showCancel: false,
            });
          }
          this.setData({ list: (result.list || []).map(decorateProduct), searched: true, keyword: 'ISBN ' + isbn });
        } finally {
          this.setData({ loading: false });
        }
      },
    });
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.id });
  },
});
