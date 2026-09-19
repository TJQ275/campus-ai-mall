const api = require('../../utils/api');
const { yuan, orderStatus, afterSaleStatus } = require('../../utils/format');
const { showError, setCartBadge } = require('../../utils/ui');
const { ADMIN_URL } = require('../../config');

Page({
  data: {
    nickname: '',
    adminUrl: ADMIN_URL,
    kpi: [],
    orders: [],
    afterSales: [],
    loading: true,
  },

  onShow() {
    // 商家接口都要求 admin 角色，被降权或 token 过期时 request 层会自动回登录页
    if (api.getRole() !== 'admin') {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    setCartBadge(0);
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
      const user = api.getUser() || {};
      const overview = await api.merchantOverview();
      const orderPage = await api.merchantOrders({ status: 'paid', page: 1, pageSize: 20 });
      const salePage = await api.merchantAfterSales({ status: 'pending', page: 1, pageSize: 20 });

      const kpi = overview.kpi || {};
      this.setData({
        nickname: user.nickname || '商家',
        kpi: [
          { label: '待发货', value: orderPage.total || 0, key: 'ship' },
          { label: '待审售后', value: salePage.total || 0, key: 'sale' },
          { label: '订单总数', value: kpi.order_count || 0 },
          { label: '成交金额', value: yuan(kpi.paid_cents || 0) },
          { label: 'AI 促成', value: kpi.ai_order_count || 0 },
        ],
        orders: (orderPage.list || []).map((o) => Object.assign({}, o, {
          statusText: orderStatus(o.status),
          payText: yuan(o.payCents),
          firstTitle: (o.items && o.items[0] && o.items[0].titleSnapshot) || '',
          itemCount: (o.items || []).reduce((sum, i) => sum + i.quantity, 0),
        })),
        afterSales: (salePage.list || []).map((a) => Object.assign({}, a, {
          statusText: afterSaleStatus(a.status),
          amountText: yuan(a.amountCents),
        })),
      });
    } catch (err) {
      showError(err, '加载失败，请下拉重试');
    } finally {
      this.setData({ loading: false });
    }
  },

  async ship(e) {
    const id = e.currentTarget.dataset.id;
    const confirm = await new Promise((resolve) =>
      wx.showModal({ title: '确认发货？', content: '发货后用户会看到「待收货」', success: (r) => resolve(r.confirm) }),
    );
    if (!confirm) return;
    try {
      await api.merchantShip(id);
      wx.showToast({ title: '已发货' });
      this.load();
    } catch (err) {
      showError(err, '发货失败');
    }
  },

  async audit(e) {
    const { id, approve } = e.currentTarget.dataset;
    const yes = approve === 'true' || approve === true;
    const confirm = await new Promise((resolve) =>
      wx.showModal({
        title: yes ? '同意退款？' : '拒绝退款？',
        content: yes ? '同意后会立刻把钱退回用户余额并回滚库存' : '拒绝后用户会看到处理意见',
        success: (r) => resolve(r.confirm),
      }),
    );
    if (!confirm) return;
    try {
      await api.merchantAudit(Number(id), yes, yes ? '审核通过' : '不符合退款条件');
      wx.showToast({ title: yes ? '已退款' : '已拒绝' });
      this.load();
    } catch (err) {
      showError(err, '审核失败');
    }
  },

  /** 商品编辑和 AI 配置在手机端做不了，给出电脑端地址并支持一键复制 */
  copyAdminUrl() {
    wx.setClipboardData({
      data: ADMIN_URL,
      success: () => wx.showToast({ title: '后台地址已复制', icon: 'none' }),
    });
  },

  goShop() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  logout() {
    wx.showModal({
      title: '退出商家登录？',
      success: (r) => {
        if (!r.confirm) return;
        api.logout();
        wx.reLaunch({ url: '/pages/login/index' });
      },
    });
  },
});
