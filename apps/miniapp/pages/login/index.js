const api = require('../../utils/api');
const { showError } = require('../../utils/ui');
const { BASE_URL, ENV_NAME } = require('../../config');

Page({
  data: {
    role: 'user',
    loading: false,
    // 买家
    nickname: '',
    avatarUrl: '',
    avatarTempPath: '',
    // 商家：预填演示账号，和管理后台登录页保持一致；接手后第一件事就是改密码
    username: 'admin',
    password: 'admin123',
    // 真机上没控制台，把当前连的后端显示出来，连不上时一眼能看出是哪套环境
    apiHost: BASE_URL.replace(/^https?:\/\//, '').replace(/\/api\/?$/, ''),
    envName: ENV_NAME,
  },

  onLoad() {
    // 已经登录过就直接进对应的端，不再让用户重新点一次
    if (api.getToken()) this.enter();
  },

  switchRole(e) {
    this.setData({ role: e.currentTarget.dataset.role });
  },

  onField(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },

  onNickname(e) {
    this.setData({ nickname: e.detail.value });
  },

  /** chooseAvatar 拿到的是本地临时路径，先记住，等登录拿到 token 再上传换成真实 URL */
  onChooseAvatar(e) {
    const path = e.detail.avatarUrl;
    if (!path) return;
    this.setData({ avatarUrl: path, avatarTempPath: path });
  },

  /** 临时图片 → base64 → POST /upload → 返回可长期访问的 URL */
  uploadAvatar(filePath) {
    return new Promise((resolve) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: async (res) => {
          const ext = (filePath.split('.').pop() || 'png').toLowerCase();
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
          try {
            const uploaded = await api.uploadImage('data:' + mime + ';base64,' + res.data);
            resolve(uploaded.url);
          } catch (err) {
            resolve(''); // 头像上传失败不该挡住登录
          }
        },
        fail: () => resolve(''),
      });
    });
  },

  /** 买家：微信一键登录（用户自己点了才算数，不再静默建号） */
  async userLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({
          success: (res) => resolve(res.code || 'dev-code'),
          fail: reject,
        });
      });

      const nickname = (this.data.nickname || '').trim();
      const session = await api.wxLogin(code, nickname ? { nickname } : undefined);
      api.setupSession(session);

      if (this.data.avatarTempPath) {
        const url = await this.uploadAvatar(this.data.avatarTempPath);
        if (url) await api.updateMe({ avatar: url });
      }

      wx.showToast({ title: '登录成功' });
      setTimeout(() => this.enter(), 400);
    } catch (err) {
      showError(err, '登录失败，请重试');
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 商家：账号密码登录，成功后进手机端商家面板 */
  async adminLogin() {
    if (this.data.loading) return;
    const username = (this.data.username || '').trim();
    const password = this.data.password || '';
    if (!username || !password) {
      wx.showToast({ title: '请填写账号和密码', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const session = await api.adminLogin(username, password);
      api.setupSession(session);
      wx.showToast({ title: '登录成功' });
      setTimeout(() => wx.reLaunch({ url: '/pages/merchant/index' }), 400);
    } catch (err) {
      showError(err, '账号或密码错误');
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 按已登录的身份进对应的端 */
  enter() {
    if (api.getRole() === 'admin') {
      wx.reLaunch({ url: '/pages/merchant/index' });
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },
});