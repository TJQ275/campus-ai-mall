const api = require('../../utils/api');
const { yuan } = require('../../utils/format');

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
    this.load();
  },

  async load() {
    const preview = await api.orderPreview();
    const wallet = await api.wallet();
    const addresses = preview.addresses || [];
    const index = Math.max(0, addresses.findIndex((a) => a.id === (preview.defaultAddress || {}).id));
    this.setData({
      items: (preview.items || []).map((i) => Object.assign({}, i, { priceText: yuan(i.priceCents) })),
      addresses,
      addressIndex: index,
      address: addresses[index] || null,
      totalText: yuan(preview.totalCents),
      freightText: preview.freightCents ? yuan(preview.freightCents) : '免配送费',
      payText: yuan(preview.payCents),
      balanceText: yuan(wallet.balanceCents),
    });
  },

  pickAddress(e) {
    const index = Number(e.detail.value);
    this.setData({ addressIndex: index, address: this.data.addresses[index] });
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value });
  },

  pickChannel(e) {
    this.setData({ channel: e.currentTarget.dataset.channel });
  },

  goAddress() {
    wx.navigateTo({ url: '/pages/address/list?pick=1' });
  },

  async submit() {
    if (!this.data.address) return wx.showToast({ title: '请先添加收货地址', icon: 'none' });
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const order = await api.createOrder({ addressId: this.data.address.id, remark: this.data.remark });
      const paid = await api.payOrder(order.id, this.data.channel);
      wx.showToast({ title: '支付成功' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/order/detail?id=' + paid.id });
      }, 600);
    } finally {
      this.setData({ submitting: false });
    }
  },
});
