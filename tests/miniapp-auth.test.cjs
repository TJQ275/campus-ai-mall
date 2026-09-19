/**
 * 登录态行为测试（Node 桩替换 wx API，真实打后端）。
 *
 * 覆盖三件事：
 *   1. 没登录时调受保护接口 → **不静默建号**，直接跳登录页（这是本次改动的核心）
 *   2. 主动登录后 → 会话写入 Storage，后续请求带 token
 *   3. 退出登录 → token / user / role 全部清掉，不会残留商家身份
 */
const store = {};
const calls = [];
const redirects = [];
let loginCount = 0;

global.getCurrentPages = () => [];

global.wx = {
  getStorageSync: (k) => store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  showToast: () => {},
  reLaunch: ({ url }) => redirects.push(url),
  switchTab: ({ url }) => redirects.push(url),
  login: ({ success }) => { loginCount += 1; success({ code: 'auth-test-' + Date.now() }); },
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
  // 1. 没登录 → 不发请求、不建号、跳登录页
  await api.cart().then(
    () => { throw new Error('未登录竟然请求成功了'); },
    () => {},
  );
  const wxLoginCalls = calls.filter((c) => c.url.includes('/auth/wx/login'));
  assert.strictEqual(calls.length, 0, '未登录时不应发出任何请求，实际发了 ' + calls.length + ' 个');
  assert.strictEqual(wxLoginCalls.length, 0, '未登录时不应静默建号');
  assert.strictEqual(loginCount, 0, '不应自动调用 wx.login');
  assert.deepStrictEqual(redirects, ['/pages/login/index'], '应跳转到登录页，实际 ' + JSON.stringify(redirects));
  console.log('未登录请求 → 跳转 ' + redirects[0] + '（未发请求、未建号）');

  // 2. 主动登录
  redirects.length = 0;
  const code = await new Promise((resolve) => wx.login({ success: (res) => resolve(res.code) }));
  const session = await api.wxLogin(code, { nickname: '登录测试同学' });
  api.setupSession(session);
  assert.ok(store.token, '登录后应写入 token');
  assert.strictEqual(store.role, 'user', '普通用户角色应为 user');
  assert.strictEqual(store.user.nickname, '登录测试同学', '应保存真实昵称');

  const me = await api.me();
  assert.strictEqual(me.nickname, '登录测试同学', '后端返回的昵称应与登录时一致');
  const lastCall = calls[calls.length - 1];
  assert.ok(lastCall.auth, '登录后的请求必须带 token');
  console.log('主动登录 → 昵称「' + me.nickname + '」，后续请求带 token');

  // 3. 退出登录要清干净（尤其是 role，否则商家退出后还会以为自己有权限）
  api.logout();
  assert.strictEqual(store.token, undefined, '退出后 token 应被清除');
  assert.strictEqual(store.user, undefined, '退出后 user 应被清除');
  assert.strictEqual(store.role, undefined, '退出后 role 应被清除');
  console.log('退出登录 → token / user / role 均已清除');

  console.log('\nRESULT: 登录态行为验证通过（不静默建号 / 主动登录 / 退出清干净）');
}

main().catch((err) => { console.error('失败:', err.message); process.exit(1); });
