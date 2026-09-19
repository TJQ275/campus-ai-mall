const { BASE_URL } = require('../config');

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
 * 统一请求：自动带 token、统一解包 { code, message, data }。
 *
 * 关键点：需要鉴权但还没有 token 时，**先等登录完成再发请求**。
 * 否则首屏 onShow 里的请求（例如购物车角标）会先吃一个 401 再重试，
 * 控制台一片红色，还白跑一趟网络。
 */
function request(options) {
  const { url, method = 'GET', data, header = {}, needAuth = true } = options;
  const ready = needAuth && !getToken() ? ensureLogin().catch(() => null) : Promise.resolve();

  return ready.then(() => new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header: Object.assign(
        { 'content-type': 'application/json' },
        needAuth && getToken() ? { Authorization: 'Bearer ' + getToken() } : {},
        header,
      ),
      success(res) {
        const body = res.data || {};
        if (body.code === 0) return resolve(body.data);
        if (res.statusCode === 401) {
          // token 过期：清掉、重新登录、再试一次
          wx.removeStorageSync('token');
          ensureLogin()
            .then(() => request(options).then(resolve).catch(reject))
            .catch(reject);
          return;
        }
        wx.showToast({ title: body.message || '请求失败', icon: 'none' });
        reject(new Error(body.message || '请求失败'));
      },
      fail(err) {
        wx.showToast({ title: '网络异常，请检查后端是否启动', icon: 'none' });
        reject(err);
      },
    });
  }));
}

module.exports = { request, ensureLogin, getToken };
