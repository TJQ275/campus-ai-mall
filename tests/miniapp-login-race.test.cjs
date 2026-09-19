/**
 * 回归测试：首屏 onShow 的请求不应再吃 401。
 *
 * 之前的 bug：页面 onShow 里直接调 api.cart()，此时 app.js 的 onLaunch 还没登录完，
 * 请求不带 token → 401 → 触发「重新登录 + 重试」，控制台一片红、网络白跑一趟。
 * 现在 request() 会先等登录完成，所以第一个 /api/cart 请求就应该带着 token。
 */
const store = {};
const calls = [];

global.wx = {
  getStorageSync: (k) => store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  showToast: () => {},
  login: ({ success }) => success({ code: 'race-test-' + Date.now() }),
  request(options) {
    calls.push({ url: options.url, auth: Boolean(options.header && options.header.Authorization) });
    const init = { method: options.method || 'GET', headers: Object.assign({ 'content-type': 'application/json' }, options.header || {}) };
    if (options.method && options.method !== 'GET' && options.data) init.body = JSON.stringify(options.data);
    fetch(options.url, init)
      .then(async (res) => options.success && options.success({ statusCode: res.status, data: await res.json().catch(() => ({})) }))
      .catch((err) => options.fail && options.fail(err));
    return { onChunkReceived() {}, abort() {} };
  },
};

const api = require('../apps/miniapp/utils/api');
const assert = require('node:assert');

async function main() {
  // 故意不先登录，直接模拟页面 onShow 抢跑
  const cart = await api.cart();

  const cartCalls = calls.filter((c) => c.url.includes('/api/cart'));
  const unauthenticated = calls.filter((c) => !c.auth && !c.url.includes('/auth/wx/login'));

  console.log('请求序列:');
  for (const c of calls) console.log('  ' + (c.auth ? '[带 token] ' : '[无 token] ') + c.url.replace(/^.*\/api/, '/api'));
  console.log('购物车结果: ' + cart.totalCount + ' 种 / ' + cart.totalQuantity + ' 件');

  assert.strictEqual(cartCalls.length, 1, '购物车只应请求一次，实际 ' + cartCalls.length + ' 次（说明仍在 401 重试）');
  assert.strictEqual(unauthenticated.length, 0, '除登录接口外不应有无 token 的请求：' + JSON.stringify(unauthenticated));
  assert.ok(store.token, '登录后应写入 token');
  console.log('\nRESULT: 首屏抢跑不再产生 401（请求前已确保登录）');
}

main().catch((err) => { console.error('失败:', err.message); process.exit(1); });
