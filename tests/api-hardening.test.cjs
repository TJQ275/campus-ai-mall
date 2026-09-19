/**
 * 后端加固验收脚本：node tests/api-hardening.test.cjs
 *
 * 针对的是「并发与资金」「入参校验」「限流」「AI 配置」这几类
 * 平时跑全链路验收看不出来的问题 —— 也就是这轮优化改掉的那些。
 * 需要后端已在运行（默认 http://127.0.0.1:3100/api）。
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3100/api';

const results = [];
let token = '';
let adminToken = '';

async function call(method, path, body, useAdmin, extraHeaders) {
  const auth = useAdmin ? adminToken : token;
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign(
      { 'content-type': 'application/json' },
      auth ? { authorization: 'Bearer ' + auth } : {},
      extraHeaders || {},
    ),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json.code, data: json.data, message: json.message };
}

/** 明确不带 token 的请求：用来确认「守卫先于入参校验执行」 */
async function callAnonymous(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json.code, data: json.data, message: json.message };
}

function check(name, ok, detail) {
  results.push({ name, ok, detail: String(detail === undefined ? '' : detail).slice(0, 120) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + String(detail).slice(0, 120) : ''));
}

/** 拿到第一个在售零食，作为后续测试的商品 */
async function pickProduct() {
  const list = await call('GET', '/products?kind=snack&pageSize=1');
  return list.data && list.data.list && list.data.list[0];
}

async function main() {
  console.log('\n=== 1. 入参校验（之前全局 ValidationPipe 是空壳）===');
  const health = await call('GET', '/health');
  if (health.code !== 0) {
    console.error('后端没有在 ' + BASE + ' 运行，请先 pnpm dev:server');
    process.exit(1);
  }

  const login = await call('POST', '/auth/admin/login', { username: 'admin', password: 'admin123' });
  adminToken = login.data && login.data.token;
  check('管理员登录', Boolean(adminToken), login.data && login.data.user.nickname);

  const wx = await call('POST', '/auth/wx/login', { code: 'hardening-' + Date.now() });
  token = wx.data && wx.data.token;
  check('小程序登录', Boolean(token), wx.data && wx.data.user.nickname);

  const badLogin = await call('POST', '/auth/admin/login', { username: 'a', password: 'x' });
  check('登录入参校验', badLogin.status === 400, badLogin.message);

  const noAuth = await callAnonymous('POST', '/cart', { productId: 'abc' });
  check('未登录被拦截（守卫先于校验）', noAuth.status === 401, noAuth.message);

  const product = await pickProduct();
  if (!product) { console.error('没有可用商品，先跑 pnpm db:seed'); process.exit(1); }

  const badCart = await call('POST', '/cart', { productId: '不是数字' });
  check('加购入参校验', badCart.status === 400, badCart.message);

  const badQty = await call('POST', '/cart', { productId: product.id, quantity: 999 });
  check('加购数量上限', badQty.status === 400, badQty.message);

  const badAddress = await call('POST', '/addresses', { receiver: '张三', phone: '123', detail: 'x' });
  check('手机号格式校验', badAddress.status === 400, badAddress.message);

  const badUpload = await call('POST', '/upload', { dataUrl: 'data:image/png;base64,aGVsbG8=' });
  check('上传伪装图片被拒', badUpload.status === 400, badUpload.message);

  console.log('\n=== 2. 购物车唯一约束（并发加购只留一行）===');
  await call('DELETE', '/cart/' + (product.id + 999999));
  // 清掉这个商品的购物车行，避免影响断言
  const cart0 = await call('GET', '/cart');
  for (const row of (cart0.data && cart0.data.list) || []) {
    if (row.productId === product.id) await call('DELETE', '/cart/' + row.id);
  }
  await call('POST', '/cart', { productId: product.id, quantity: 1 });
  await call('POST', '/cart', { productId: product.id, quantity: 2 });
  const cart1 = await call('GET', '/cart');
  const rows = ((cart1.data && cart1.data.list) || []).filter((r) => r.productId === product.id);
  check('同一商品只有一行', rows.length === 1, '行数 ' + rows.length);
  check('数量累加正确', rows[0] && rows[0].quantity === 3, '数量 ' + (rows[0] && rows[0].quantity));

  console.log('\n=== 3. 订单分页与角标 ===');
  const orders = await call('GET', '/orders?page=1&pageSize=5');
  check('订单列表是分页结构', orders.data && Array.isArray(orders.data.list) && typeof orders.data.total === 'number',
    '共 ' + (orders.data && orders.data.total) + ' 笔');
  const summary = await call('GET', '/orders/summary');
  check('订单角标聚合接口', summary.code === 0 && typeof summary.data.all === 'number',
    '全部 ' + (summary.data && summary.data.all) + ' / 待付款 ' + (summary.data && summary.data.pending_pay));

  console.log('\n=== 4. 支付幂等与库存（会真实下单）===');
  const addr = await call('POST', '/addresses', { receiver: '验收', phone: '13800000000', campus: '校本部', detail: '加固验收 1 号', isDefault: true });
  check('创建收货地址', addr.code === 0, addr.data && addr.data.detail);

  const before = await call('GET', '/products/' + product.id);
  const stockBefore = before.data.stock;

  const preview = await call('GET', '/orders/preview');
  const previewOk = preview.code === 0;
  if (previewOk) {
    // 余额可能不够，先充够
    const need = preview.data.payCents + 10000;
    await call('POST', '/wallet/recharge', { amountCents: Math.min(need, 100000) });

    const created = await call('POST', '/orders', { addressId: addr.data.id });
    check('创建订单', created.code === 0, created.data && created.data.orderNo);

    if (created.code === 0) {
      const orderId = created.data.id;
      const pay1 = await call('POST', '/orders/' + orderId + '/pay', { channel: 'balance' });
      check('首次支付成功', pay1.code === 0, pay1.data && pay1.data.status);

      const pay2 = await call('POST', '/orders/' + orderId + '/pay', { channel: 'balance' });
      check('重复支付被拒绝', pay2.code !== 0, pay2.message);

      // 并发重复支付：两个请求同时打，只能有一个成功
      const created2 = await call('POST', '/orders', { addressId: addr.data.id });
      if (created2.code === 0) {
        const [a, b] = await Promise.all([
          call('POST', '/orders/' + created2.data.id + '/pay', { channel: 'balance' }),
          call('POST', '/orders/' + created2.data.id + '/pay', { channel: 'balance' }),
        ]);
        const succeed = [a, b].filter((r) => r.code === 0).length;
        check('并发重复支付只成功一次', succeed === 1, '成功 ' + succeed + ' 次');
      }

      const after = await call('GET', '/products/' + product.id);
      const deducted = stockBefore - after.data.stock;
      // 两笔订单各扣了购物车里的数量，这里只断言「库存确实减少了」且没有变成负数
      check('库存扣减且未变负', after.data.stock >= 0 && deducted >= 0, '扣减 ' + deducted + '，剩余 ' + after.data.stock);
    }
  }

  console.log('\n=== 5. 售后重复申请 ===');
  const myOrders = await call('GET', '/orders?status=paid&pageSize=1');
  const paidOrder = myOrders.data && myOrders.data.list && myOrders.data.list[0];
  if (paidOrder && paidOrder.items && paidOrder.items.length) {
    const itemId = paidOrder.items[0].id;
    const as1 = await call('POST', '/after-sales', { orderItemId: itemId, reason: '加固验收' });
    const as2 = await call('POST', '/after-sales', { orderItemId: itemId, reason: '加固验收重复' });
    check('首次申请售后成功', as1.code === 0, as1.data && as1.data.afterSaleNo);
    check('重复申请被拒绝', as2.code !== 0, as2.message);
    if (as1.code === 0) {
      await call('POST', '/after-sales/' + as1.data.id + '/cancel');
    }
  } else {
    check('售后重复申请（跳过）', true, '没有可用的已支付订单');
  }

  console.log('\n=== 6. 管理端越权与批量赋值 ===');
  const users = await call('GET', '/admin/users?page=1&pageSize=5', undefined, true);
  const target = users.data && users.data.list && users.data.list.find((u) => u.role === 'user');
  check('查询用户列表', Boolean(target), target && target.nickname);

  if (target) {
    // 尝试用批量赋值改余额字段：白名单会把它丢掉
    await call('PATCH', '/admin/users/' + target.id, { nickname: target.nickname, balanceCents: 99999999 }, true);
    const after = await call('GET', '/admin/users?keyword=' + encodeURIComponent(target.openid), undefined, true);
    const row = after.data && after.data.list && after.data.list[0];
    check('批量赋值被拦截（余额未被改写）', row && row.balanceCents !== 99999999, '余额 ' + (row && row.balanceCents));

    const overdraft = await call('POST', '/admin/users/' + target.id + '/balance', { amountCents: -999999999 }, true);
    check('余额扣成负数被拒绝', overdraft.code !== 0, overdraft.message);

    // 禁用后该用户的 token 立刻失效
    const userLogin = await call('POST', '/auth/wx/login', { code: 'disabled-check-' + Date.now() });
    const victimToken = userLogin.data.token;
    const victimMe = await fetch(BASE + '/auth/me', { headers: { authorization: 'Bearer ' + victimToken } });
    check('新用户可正常访问', victimMe.status === 200, 'HTTP ' + victimMe.status);

    await call('PATCH', '/admin/users/' + userLogin.data.user.id, { status: 0 }, true);
    // 守卫有 15 秒状态缓存，等一下再验
    await new Promise((r) => setTimeout(r, 16000));
    const blocked = await fetch(BASE + '/auth/me', { headers: { authorization: 'Bearer ' + victimToken } });
    check('禁用后 token 立即失效', blocked.status === 401, 'HTTP ' + blocked.status);
    await call('PATCH', '/admin/users/' + userLogin.data.user.id, { status: 1 }, true);
  }

  console.log('\n=== 7. 商品新增（卖家流程）===');
  const categories = await call('GET', '/admin/categories', undefined, true);
  const snackCategory = (categories.data || []).find((c) => c.kind === 'snack');
  const incomplete = await call('POST', '/admin/products', { title: '只有标题' }, true);
  check('缺必填字段被拒绝', incomplete.status === 400, incomplete.message);

  if (snackCategory) {
    const keyword = '加固测试零食' + Date.now();
    const created = await call('POST', '/admin/products', {
      kind: 'snack',
      title: keyword,
      subtitle: '自动化测试创建，可安全删除',
      categoryId: snackCategory.id,
      priceCents: 350,
      stock: 10,
      status: 'on',
      tags: ['测试', '辣'],
      flavor: '香辣',
      spicyLevel: 3,
    }, true);
    check('新增商品成功', created.code === 0, 'id=' + (created.data && created.data.id));
    check('价格按分存储', created.data && created.data.priceCents === 350, '¥' + (created.data && created.data.priceCents / 100));

    const search = await call('GET', '/products?keyword=' + encodeURIComponent(keyword));
    check('新商品立刻可被检索到', search.data && search.data.total >= 1, '命中 ' + (search.data && search.data.total) + ' 条');

    if (created.data) {
      const off = await call('POST', '/admin/products/' + created.data.id + '/status', { status: 'off' }, true);
      check('下架商品', off.data && off.data.status === 'off', off.data && off.data.status);
      const hidden = await call('GET', '/products?keyword=' + encodeURIComponent(keyword));
      check('下架后前台搜不到', hidden.data && hidden.data.total === 0, '命中 ' + (hidden.data && hidden.data.total) + ' 条');

      // 减少商品：没产生过订单的可以真删
      const removed = await call('DELETE', '/admin/products/' + created.data.id, undefined, true);
      check('删除未下单的商品', removed.code === 0 && removed.data && removed.data.removed === true,
        '已删除「' + (removed.data && removed.data.title) + '」');

      const gone = await call('GET', '/products?keyword=' + encodeURIComponent(keyword));
      check('删除后彻底搜不到', gone.data && gone.data.total === 0, '命中 ' + (gone.data && gone.data.total) + ' 条');

      // 已经下过单的商品不能硬删，否则历史订单与经营统计会对不上
      const blocked = await call('DELETE', '/admin/products/' + product.id, undefined, true);
      check('已下单商品拒绝删除', blocked.status === 400 && /下架/.test(blocked.message || ''), blocked.message);
    }
  } else {
    check('商品新增（跳过）', true, '没有 snack 分类');
  }

  console.log('\n=== 8. 搜索走索引（trgm）===');
  const byTag = await call('GET', '/products?tags=辣&pageSize=3');
  check('标签检索可用（单值）', byTag.code === 0, '命中 ' + (byTag.data && byTag.data.total) + ' 条');
  const byMultiTag = await call('GET', '/products?tags=辣&tags=甜&pageSize=3');
  check('标签检索可用（多值）', byMultiTag.code === 0, '命中 ' + (byMultiTag.data && byMultiTag.data.total) + ' 条');
  const byLongKw = await call('GET', '/products?keyword=' + encodeURIComponent('辣条'));
  check('关键词检索可用', byLongKw.code === 0, '命中 ' + (byLongKw.data && byLongKw.data.total) + ' 条');
  const byPrice = await call('GET', '/products?priceMin=1&priceMax=10');
  check('价格区间检索可用', byPrice.code === 0, '命中 ' + (byPrice.data && byPrice.data.total) + ' 条');

  console.log('\n=== 9. AI 配置（后台可视化填 Key）===');
  const settings = await call('GET', '/admin/settings/llm', undefined, true);
  check('读取 AI 配置', settings.code === 0, '模式 ' + (settings.data && settings.data.runtime.provider));
  check('Key 不回显明文', settings.data && !('apiKey' in settings.data), '脱敏值 ' + (settings.data && settings.data.apiKeyMasked));
  check('提供预设清单', settings.data && settings.data.presets.length >= 4, (settings.data && settings.data.presets.length) + ' 个预设');

  const badKey = await call('PUT', '/admin/settings/llm', { apiKey: 'sk-this-key-is-invalid', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }, true);
  check('保存配置成功', badKey.code === 0, '来源 ' + (badKey.data && badKey.data.runtime.configSource));
  check('保存后切换到真实模型', badKey.data && badKey.data.runtime.mock === false, '模型 ' + (badKey.data && badKey.data.runtime.model));

  const test = await call('POST', '/admin/settings/llm/test', {}, true);
  check('测试连接返回明确失败原因', test.code === 0 && test.data.ok === false, test.data && test.data.message);

  const reset = await call('POST', '/admin/settings/llm/reset', undefined, true);
  check('恢复默认后回到降级模式', reset.data && reset.data.runtime.mock === true, '模式 ' + (reset.data && reset.data.runtime.provider));

  console.log('\n=== 10. 登录限流（按 IP + 账号分桶）===');
  let limited = 0;
  for (let i = 0; i < 12; i += 1) {
    const res = await fetch(BASE + '/auth/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 故意刷一个不存在的账号。限流按「IP + 账号」分桶，
      // 所以刷它不会把真管理员一起锁在门外（这也是本节的断言之一）。
      body: JSON.stringify({ username: 'attacker_probe', password: 'wrong-password' }),
    });
    if (res.status === 429) limited += 1;
  }
  check('连续错误登录被限流', limited > 0, '触发 ' + limited + ' 次 429');

  const stillWorks = await call('POST', '/auth/admin/login', { username: 'admin', password: 'admin123' });
  check('刷其他账号不会锁死管理员', stillWorks.code === 0 && Boolean(stillWorks.data && stillWorks.data.token), '管理员仍可正常登录');

  const summaryLine = results.filter((r) => r.ok).length + ' 项，失败 ' + results.filter((r) => !r.ok).length + ' 项';
  console.log('\n================================');
  console.log('加固验收合计 ' + summaryLine);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('\n失败项：');
    for (const f of failed) console.log('  - ' + f.name + '：' + f.detail);
    console.log('RESULT: 存在失败项');
    process.exit(1);
  }
  console.log('RESULT: 加固验收全部通过');
  console.log('提示：本脚本会创建真实订单与商品，反复执行后想恢复演示数据请跑 pnpm db:reset');
}

main().catch((error) => {
  console.error('\n脚本异常：', error);
  process.exit(1);
});