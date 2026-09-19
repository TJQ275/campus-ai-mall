const api = require('../../utils/api');
const { yuan, assetUrl } = require('../../utils/format');
const { showError, onImageError } = require('../../utils/ui');

Page({
  data: {
    items: [],
    address: null,
    addresses: [],
    addressIndex: 0,
    totalText: '',
    freightText: '',
    payText: '',
    remark: '',
    channel: 'balance',
    submitting: false,
    balanceText: '',
  },

  onShow() {
    // 提交中从地址页返回也要刷新金额，但按钮要等流程结束才放开
    this.load();
  },

  async load() {
    try {
      const preview = await api.orderPreview();
      const wallet = await api.wallet();
      const addresses = preview.addresses || [];
      // 用户主动挑过的地址优先；没有才用服务端默认地址
      const chosen = this.pickedAddress || preview.defaultAddress || {};
      const index = Math.max(0, addresses.findIndex((a) => a.id === chosen.id));
      this.setData({
        addresses,
        addressIndex: index,
        address: addresses[index] || null,
        items: (preview.items || []).map((i) => Object.assign({}, i, {
          priceText: yuan(i.priceCents),
          cover: assetUrl(i.cover),
        })),
        totalText: yuan(preview.totalCents),
        freightText: preview.freightCents ? yuan(preview.freightCents) : '免配送费',
        payText: yuan(preview.payCents),
        balanceText: yuan(wallet.balanceCents),
        submitting: false,
      });
    } catch (err) {
      showError(err, '结算信息加载失败');
    }
  },

  /** 地址列表页选完回传（见 pages/address/list.js 的 pick） */
  applyPickedAddress(address) {
    if (!address) return;
    this.pickedAddress = address;
    this.setData({ address, addressIndex: Math.max(0, this.data.addresses.findIndex((a) => a.id === address.id)) });
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value });
  },

  pickChannel(e) {
    this.setData({ channel: e.currentTarget.dataset.channel });
  },

  goAddress() {
    wx.navigateTo({
      url: '/pages/address/list?pick=1',
      events: {
        pickAddress: (address) => this.applyPickedAddress(address),
      },
    });
  },

  async submit() {
    if (!this.data.address) return wx.showToast({ title: '请先添加收货地址', icon: 'none' });
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    let order = null;
    try {
      order = await api.createOrder({ addressId: this.data.address.id, remark: this.data.remark });
      const paid = await api.payOrder(order.id, this.data.channel);
      wx.showToast({ title: '支付成功' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/order/detail?id=' + paid.id });
      }, 600);
    } catch (err) {
      if (!order) {
        this.setData({ submitting: false });
        return showError(err, '下单失败，请重试');
      }
      /*
       * 订单已经创建、只是支付失败（例如余额不足）。
       * 这里绝不能重新放开按钮：用户再点一次就变成两笔订单。
       * 把订单号告诉他，并送去详情页继续支付。
       */
      wx.showModal({
        title: '订单已创建，支付未完成',
        content: '订单号 ' + order.orderNo + '，应付 ' + yuan(order.payCents) + '。'
          + ((err && err.message) || '支付失败') + '，可在订单详情里继续支付。',
        showCancel: false,
        success: () => wx.redirectTo({ url: '/pages/order/detail?id=' + order.id }),
        fail: () => wx.redirectTo({ url: '/pages/order/detail?id=' + order.id }),
      });
    }
  },

  onImageError: onImageError,
});
