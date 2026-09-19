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

module.exports = {
  BASE_URL,
  /** 图片资源前缀：后端静态托管的 /uploads 只给相对路径，必须补上源站才能塞进 <image src> */
  ASSET_URL: BASE_URL.replace(/\/api\/?$/, ''),
};
