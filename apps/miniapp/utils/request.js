const { BASE_URL } = require('../config');

function getToken() {
  return wx.getStorageSync('token') || '';
}

/** 统一请求：自动带 token、统一解包 { code, message, data }、401 自动静默登录 */
function request(options) {
  const { url, method = 'GET', data, header = {}, needAuth = true } = options;

  return new Promise((resolve, reject) => {
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
  });
}

/** 小程序登录：code 换 token（后端未配置 WX_APPID 时走开发模式） */
function ensureLogin() {
  if (getToken()) return Promise.resolve(getToken());
  return new Promise((resolve, reject) => {
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
  });
}

module.exports = { request, ensureLogin, getToken };
