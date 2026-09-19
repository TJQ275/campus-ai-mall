/**
 * 页面层的小工具：把「每个页面都要写一遍」的几件事收在一处。
 * 只做 UI 副作用，不碰业务数据。
 */

/** 购物车在 tabBar 里的下标 */
const CART_TAB_INDEX = 2;

/**
 * 统一失败提示。
 * async 事件处理里 catch 后调用，否则失败时页面和「没有数据」长得一模一样。
 */
function showError(err, fallback) {
  const message = (err && err.message) || fallback || '操作失败，请重试';
  // 请求层已经弹过的（例如 401）不再重复弹
  if (err && err.toasted) return;
  wx.showToast({ title: String(message).slice(0, 30), icon: 'none' });
}

/**
 * 购物车角标：下标写死 2 处很分散，这里统一；文本最多 4 个字符，超过 99 显示 99+。
 * 非 tabBar 页面或自定义 tabBar 下调用会失败，直接忽略，不影响主流程。
 */
function setCartBadge(count) {
  const total = Number(count) || 0;
  const ignore = { fail: () => {} };
  if (total > 0) {
    wx.setTabBarBadge(Object.assign({
      index: CART_TAB_INDEX,
      text: total > 99 ? '99+' : String(total).slice(0, 4),
    }, ignore));
  } else {
    wx.removeTabBarBadge(Object.assign({ index: CART_TAB_INDEX }, ignore));
  }
}

/**
 * <image> 的 binderror 统一处理：按 data-path 给该条数据打上 failed 标记，
 * WXML 里用 wx:else 渲染文字占位，避免只剩一个灰框。
 */
function onImageError(e) {
  const path = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.path : '';
  if (!path || !this.setData || !this.data) return;
  // 例如 user 还没加载出来时是 null，往它下面写子路径 setData 会报错，直接跳过
  const root = path.split('.')[0].split('[')[0];
  if (this.data[root] === null || this.data[root] === undefined) return;
  this.setData({ [path]: true });
}

module.exports = { showError, setCartBadge, onImageError, CART_TAB_INDEX };
