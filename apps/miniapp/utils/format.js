/** 分 → 元，保留两位小数 */
function yuan(cents) {
  return '¥' + ((cents || 0) / 100).toFixed(2);
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

/** 商品卡片统一补一个展示用价格字段 */
function decorateProduct(item) {
  return Object.assign({}, item, {
    priceText: yuan(item.priceCents),
    originalPriceText: item.originalPriceCents ? yuan(item.originalPriceCents) : '',
  });
}

module.exports = { yuan, orderStatus, afterSaleStatus, decorateProduct };
