const { BASE_URL } = require('../config');

const TIMEOUT = 15000;

function getToken() {
  return wx.getStorageSync('token') || '';
}

let loginPromise = null;

/**
 * 小程序登录：code 换 token（后端未配置 WX_APPID 时走开发模式，code 直接映射成 openid）。
 * 并发调用共享同一个 Promise —— 首屏好几个页面同时请求时，只会发起一次 wx.login。
 */
function ensureLogin() {
  const cached = getToken();
  if (cached) return Promise.resolve(cached);
  if (loginPromise) return loginPromise;

  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        wx.request({
          url: BASE_URL + '/auth/wx/login',
          method: 'POST',
          data: { code: res.code || 'dev-code' },
          timeout: TIMEOUT,
          success(loginRes) {
            const body = loginRes.data || {};
            if (body.code === 0 && body.data && body.data.token) {
              wx.setStorageSync('token', body.data.token);
              wx.setStorageSync('user', body.data.user);
              resolve(body.data.token);
            } else {
              reject(new Error((body && body.message) || '登录失败'));
            }
          },
          fail: reject,
        });
      },
      fail: reject,
    });
  }).then(
    (token) => { loginPromise = null; return token; },
    (error) => { loginPromise = null; throw error; },
  );

  return loginPromise;
}

/**
 * 清除登录状态。
 * 只删 token 是没用的：下一个请求发现没有 token 会拿同一个微信号静默登回来。
 * 所以同时清掉缓存的用户信息和进行中的登录 Promise，让调用方（和用户）都明确知道状态被清了。
 */
function logout() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('user');
  loginPromise = null;
}

/**
 * 统一请求：自动带 token、统一解包 { code, message, data }。
 *
 * 关键点：需要鉴权但还没有 token 时，**先等登录完成再发请求**。
 * 否则首屏 onShow 里的请求（例如购物车角标）会先吃一个 401 再重试，
 * 控制台一片红色，还白跑一趟网络。
 */
function request(options, retried) {
  const { url, method = 'GET', data, header = {}, needAuth = true } = options;
  const attempt = retried || 0;
  const ready = needAuth && !getToken() ? ensureLogin().catch(() => null) : Promise.resolve();

  return ready.then(() => new Promise((resolve, reject) => {
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
          // token 过期：清掉、重新登录、再试一次。
          // 但只能重试一次 —— 后端持续返回 401 时，无上限的递归会变成死循环。
          if (attempt >= 1) {
            wx.showToast({ title: '登录已失效，请重新进入小程序', icon: 'none' });
            return failWith(body.message || '登录已失效');
          }
          wx.removeStorageSync('token');
          ensureLogin()
            .then(() => request(options, attempt + 1).then(resolve).catch(reject))
            .catch(reject);
          return;
        }
        wx.showToast({ title: body.message || '请求失败', icon: 'none' });
        return failWith(body.message || '请求失败');
      },
      fail(err) {
        if (err && /timeout/i.test(err.errMsg || '')) {
          wx.showToast({ title: '请求超时，请检查网络', icon: 'none' });
          return failWith('请求超时，请检查网络');
        }
        wx.showToast({ title: '网络异常，请检查后端是否启动', icon: 'none' });
        return failWith((err && err.errMsg) || '网络异常');
      },
    });
  }));
}

module.exports = { request, ensureLogin, logout, getToken };
