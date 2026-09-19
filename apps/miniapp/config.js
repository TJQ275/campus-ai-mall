/**
 * 后端地址。
 * 开发时在微信开发者工具里勾选「详情 → 本地设置 → 不校验合法域名」，
 * 上线前把这里换成正式域名并在小程序后台配置 request 合法域名。
 */
const ENV = {
  dev: 'http://localhost:3100/api',
  prod: 'https://your-domain.com/api',
};

const BASE_URL = ENV.dev;

/**
 * 电脑端管理后台地址。
 * 后端已经托管了管理后台构建产物，所以它和接口是**同源**的 ——
 * 这里从 BASE_URL 推导，换成公网域名（或内网穿透地址）时自动跟着变，不用单独维护。
 */
const ADMIN_URL = BASE_URL.replace(/\/api\/?$/, '');

module.exports = {
  BASE_URL,
  ADMIN_URL,
  /** 图片资源前缀：后端静态托管的 /uploads 只给相对路径，必须补上源站才能塞进 <image src> */
  ASSET_URL: BASE_URL.replace(/\/api\/?$/, ''),
};