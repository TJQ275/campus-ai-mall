const api = require('./utils/api');

App({
  globalData: {
    user: null,
  },

  onLaunch() {
    // 不再静默登录。没登录的用户由 pages/login 挡住，必须自己点一次登录。
    // 已登录时顺手刷新一次用户信息；token 失效会在下次请求时自动跳回登录页。
    if (api.getToken()) {
      api
        .me()
        .then((user) => {
          this.globalData.user = user;
        })
        .catch(() => {});
    }
  },
});
