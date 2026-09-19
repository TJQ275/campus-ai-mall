const api = require('./utils/api');

App({
  globalData: {
    user: null,
    aiMock: true,
  },

  onLaunch() {
    // 静默登录：后端未配置 WX_APPID 时会走开发模式（code 直接映射为 openid）
    api
      .ensureLogin()
      .then(() => api.me())
      .then((user) => {
        this.globalData.user = user;
      })
      .catch(() => {
        /* 首次进入未登录不阻塞浏览 */
      });
  },
});
