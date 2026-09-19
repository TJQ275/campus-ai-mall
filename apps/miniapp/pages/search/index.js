const api = require('../../utils/api');
const { decorateProduct } = require('../../utils/format');
const { showError, onImageError } = require('../../utils/ui');

Page({
  data: { keyword: '', list: [], searched: false, loading: false, hotWords: ['辣条', '薯片', '高等数学', '数据结构', '考研'] },

  onLoad(options) {
    if (options.keyword) {
      // 跳转参数是 URL 编码过的，中文关键词不解码会搜不到东西
      let keyword = options.keyword;
      try {
        keyword = decodeURIComponent(keyword);
      } catch {
        /* 不是合法编码就按原样用 */
      }
      this.setData({ keyword });
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
    } catch (err) {
      showError(err, '搜索失败，请重试');
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
        } catch (err) {
          showError(err, '查询失败，请重试');
        } finally {
          this.setData({ loading: false });
        }
      },
    });
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.id });
  },

  onImageError: onImageError,
});
