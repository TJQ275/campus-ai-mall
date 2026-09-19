const { BASE_URL } = require('../config');

const TIMEOUT = 15000;
const LOGIN_PAGE = '/pages/login/index';

/** 只保留 host:port，用于报错提示 —— 手机上没控制台，报错本身要能说明连的是哪 */
function hostOf(url) {
  return String(url).replace(/^https?:\/\//, '').replace(/\/api\/?$/, '');
}

function getToken() {
  return wx.getStorageSync('token') || '';
}

function getUser() {
  return wx.getStorageSync('user') || null;
}

function getRole() {
  return wx.getStorageSync('role') || 'user';
}

/** 登录成功后写入会话。只有登录页会调用 —— 其它地方一律不允许悄悄建号。 */
function setupSession(data) {
  wx.setStorageSync('token', data.token);
  wx.setStorageSync('user', data.user || null);
  wx.setStorageSync('role', (data.user && data.user.role) || 'user');
  return data.token;
}

/**
 * 退出登录。
 * 必须把 role 一起清掉 —— 否则商家退出后，「我的」页还会以为自己有管理权限。
 */
function logout() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('user');
  wx.removeStorageSync('role');
}

let redirecting = false;

/** 未登录 / 登录失效时统一回登录页，避免多个并发请求把登录页 reLaunch 好几次 */
function redirectToLogin() {
  const pages = getCurrentPages();
  const route = pages.length ? pages[pages.length - 1].route : '';
  if (route === 'pages/login/index' || redirecting) return;
  redirecting = true;
  wx.reLaunch({
    url: LOGIN_PAGE,
    complete() { redirecting = false; },
  });
}

/**
 * 需要登录时统一走这里。
 *
 * 注意：这里**不再自动 wx.login 建号**。以前是静默登录，用户表里全是「同学3204」
 * 这种自动生成的名字；现在改成「没登录就跳登录页」，用户必须自己点一次登录。
 */
function ensureLogin() {
  const token = getToken();
  if (token) return Promise.resolve(token);
  redirectToLogin();
  const error = new Error('请先登录');
  error.toasted = true;
  return Promise.reject(error);
}

/**
 * 统一请求：自动带 token、统一解包 { code, message, data }。
 * 未登录不发请求，直接回登录页 —— 省掉「先吃一个 401 再重登」的无谓往返。
 */
function request(options) {
  const { url, method = 'GET', data, header = {}, needAuth = true } = options;

  if (needAuth && !getToken()) return ensureLogin();

  return new Promise((resolve, reject) => {
    // 已经弹过提示的错误，页面层 catch 里不用再弹一次
    const failWith = (message) => {
      const error = new Error(message);
      error.toasted = true;
      reject(error);
    };

    wx.request({
      url: BASE_URL + url,
      method,
      data,
      timeout: TIMEOUT,
      header: Object.assign(
        { 'content-type': 'application/json' },
        needAuth && getToken() ? { Authorization: 'Bearer ' + getToken() } : {},
        header,
      ),
      success(res) {
        const body = res.data || {};
        if (body.code === 0) return resolve(body.data);
        if (res.statusCode === 401) {
          // 登录失效：清掉会话回登录页，不做静默重登（重登出来的是另一个人）
          logout();
          redirectToLogin();
          return failWith(body.message || '登录已失效，请重新登录');
        }
        wx.showToast({ title: body.message || '请求失败', icon: 'none' });
        return failWith(body.message || '请求失败');
      },
      fail(err) {
        const raw = (err && err.errMsg) || '';

        // 真机上最容易踩的一条：开发者工具里勾的「不校验合法域名」**只对模拟器生效**，
        // 真机会直接拒发请求，errMsg 是「url not in domain list」。
        // 以前这条会和真正的连不上混成同一个「网络异常」，很难排查。
        if (/url not in domain list/i.test(raw)) {
          const notice = '域名未校验：手机右上角「…」→ 开发调试 打开后重进小程序';
          wx.showToast({ title: notice, icon: 'none', duration: 4000 });
          return failWith(notice);
        }

        if (/timeout/i.test(raw)) {
          const notice = '请求超时：连不上 ' + hostOf(BASE_URL);
          wx.showToast({ title: notice, icon: 'none' });
          return failWith(notice);
        }

        const hint = '连不上 ' + hostOf(BASE_URL) + '（' + (raw || '未知错误') + '）';
        wx.showToast({ title: hint, icon: 'none', duration: 4000 });
        return failWith(hint);
      },
    });
  });
}

module.exports = { request, ensureLogin, logout, setupSession, getToken, getUser, getRole, redirectToLogin };