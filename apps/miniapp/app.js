const api = require('./utils/api');

App({
  onLaunch() {
    // 静默登录：后端未配置 WX_APPID 时会走开发模式（code 直接映射为 openid）。
    // 登录态由 utils/request 自己维护（token 存在 Storage），页面需要用户信息时各自取，
    // 这里只是把登录提前，避免首屏请求抢跑。
    api.ensureLogin().catch(() => {
      /* 首次进入未登录不阻塞浏览 */
    });
  },
});
