/**
 * 后端地址。
 *
 * 三套环境，**默认自动选择**，一般不用手动改：
 *   dev     开发者工具模拟器 → localhost（模拟器和后端在同一台机器上）
 *   device  真机预览/调试   → 电脑的局域网 IP（手机写 localhost 会连到手机自己）
 *   prod    正式发布        → https 域名，且要在小程序后台配 request 合法域名
 *
 * 自动判断依据：模拟器里 platform 是 'devtools'，真机是 'ios' / 'android'。
 * 想强制指定某套环境时，把 FORCE_ENV 改成 'dev' / 'device' / 'prod' 即可。
 *
 * 电脑局域网 IP 怎么查：ipconfig | findstr IPv4
 */
const ENV = {
  dev: 'http://localhost:3100/api',
  device: 'http://192.168.0.30:3100/api',
  prod: 'https://your-domain.com/api',
};

/** 留空 = 自动判断；填 'dev' / 'device' / 'prod' = 强制使用某一套 */
const FORCE_ENV = '';

function detectEnv() {
  if (FORCE_ENV && ENV[FORCE_ENV]) return FORCE_ENV;
  try {
    // getDeviceInfo 是新接口；老基础库退回 getSystemInfoSync
    const platform = wx.getDeviceInfo ? wx.getDeviceInfo().platform : wx.getSystemInfoSync().platform;
    return platform === 'devtools' ? 'dev' : 'device';
  } catch (err) {
    return 'dev';
  }
}

const ENV_NAME = detectEnv();
const BASE_URL = ENV[ENV_NAME];

module.exports = {
  BASE_URL,
  /** 当前生效的环境名，便于排查「为什么连不上」 */
  ENV_NAME,
  /** 电脑端管理后台：后端已托管它，跟接口同源，换地址时自动跟随 */
  ADMIN_URL: BASE_URL.replace(/\/api\/?$/, ''),
  /** 图片资源前缀：后端静态托管的 /uploads 只给相对路径，必须补上源站才能塞进 <image src> */
  ASSET_URL: BASE_URL.replace(/\/api\/?$/, ''),
};
