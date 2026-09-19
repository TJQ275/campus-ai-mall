const { ASSET_URL } = require('../config');

/** 分 → 元，保留两位小数 */
function yuan(cents) {
  return '¥' + ((cents || 0) / 100).toFixed(2);
}

/**
 * 图片地址归一化。
 * 后端上传的封面存的是 /uploads/xxx.png 这种相对路径，直接当 src 用是显示不出来的，
 * 这里统一补上源站；已经是 http(s) 的绝对地址（例如现有种子的图床）原样返回。
 */
function assetUrl(url) {
  if (!url) return '';
  const path = String(url);
  if (/^https?:\/\//i.test(path) || path.indexOf('data:') === 0) return path;
  return ASSET_URL + (path.charAt(0) === '/' ? path : '/' + path);
}

const ORDER_STATUS = {
  pending_pay: '待付款',
  paid: '待发货',
  shipped: '待收货',
  finished: '已完成',
  cancelled: '已取消',
  closed: '已关闭',
};

const AFTER_SALE_STATUS = {
  pending: '待审核',
  approved: '已同意',
  rejected: '已拒绝',
  cancelled: '已撤销',
  refunded: '已退款',
};

function orderStatus(status) {
  return ORDER_STATUS[status] || status;
}

function afterSaleStatus(status) {
  return AFTER_SALE_STATUS[status] || status;
}

/** 商品卡片统一补一个展示用价格字段与可用的封面地址 */
function decorateProduct(item) {
  return Object.assign({}, item, {
    cover: assetUrl(item && item.cover),
    priceText: yuan(item && item.priceCents),
    originalPriceText: item && item.originalPriceCents ? yuan(item.originalPriceCents) : '',
  });
}

module.exports = { yuan, assetUrl, orderStatus, afterSaleStatus, decorateProduct };
