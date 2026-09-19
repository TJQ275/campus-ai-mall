/**
 * 全链路验收脚本：pnpm test:acceptance
 *
 * 直接从 HTTP 层把「后端 + AI + 管理端接口」跑一遍，用于交付前确认环境可用。
 * 不依赖微信开发者工具，也不需要浏览器。
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3100/api';

const results = [];
let token = '';
let adminToken = '';

async function call(method, path, body, useAdmin) {
  const auth = useAdmin ? adminToken : token;
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign(
      { 'content-type': 'application/json' },
      auth ? { authorization: 'Bearer ' + auth } : {},
    ),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json.code, data: json.data, message: json.message };
}

function check(name, ok, detail) {
  results.push({ name, ok, detail: String(detail === undefined ? '' : detail).slice(0, 110) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + String(detail).slice(0, 110) : ''));
}

async function main() {
  console.log('\n=== 1. 基础服务 ===');
  const health = await call('GET', '/health');
  check('健康检查', health.code === 0, '数据库 ' + (health.data && health.data.db.driver) + ' / ' + (health.data && health.data.db.tables) + ' 张表');

  console.log('\n=== 2. 管理端 ===');
  const admin = await call('POST', '/auth/admin/login', { username: 'admin', password: 'admin123' });
  adminToken = admin.data && admin.data.token;
  check('管理员登录', Boolean(adminToken), admin.data && admin.data.user.nickname);
  const dash = await call('GET', '/admin/orders/dashboard', undefined, true);
  check('数据概览', dash.code === 0, '订单 ' + dash.data.kpi.order_count + ' / 商品 ' + dash.data.kpi.product_count);
  const stats = await call('GET', '/admin/ai/stats', undefined, true);
  check('AI 统计接口', stats.code === 0, '模式 ' + stats.data.mode.provider + ' / 向量 ' + (stats.data.embeddingEnabled ? '开' : '关'));
  const knowledge = await call('GET', '/admin/knowledge', undefined, true);
  check('知识库', knowledge.code === 0 && knowledge.data.total >= 8, knowledge.data.total + ' 条政策');
  const insight = await call('GET', '/admin/ai/insight', undefined, true);
  check('经营快报', insight.code === 0 && insight.data.points.length > 0, insight.data.points[0]);

  console.log('\n=== 3. 用户与商品 ===');
  const wx = await call('POST', '/auth/wx/login', { code: 'acceptance-' + Date.now(), nickname: '验收同学' });
  token = wx.data && wx.data.token;
  check('小程序登录', Boolean(token), 'openid=' + (wx.data && wx.data.openid));
  const home = await call('GET', '/home');
  check('首页聚合', home.code === 0 && home.data.hot.length > 0, '热销 ' + home.data.hot.length + ' / 推荐 ' + home.data.recommend.length);
  check('推荐可解释', (home.data.recommend || []).every((r) => Boolean(r.reason)), (home.data.recommend[0] || {}).reason);
  const search = await call('GET', '/products?keyword=' + encodeURIComponent('高等数学') + '&kind=book');
  check('商品检索', search.code === 0 && search.data.total > 0, '命中 ' + search.data.total + ' 条');
  const cheap = await call('GET', '/products?kind=snack&priceMax=5&sort=sales');
  check('价格过滤（元→分）', cheap.code === 0, '5 元以内 ' + cheap.data.total + ' 条');
  const snack = (await call('GET', '/products?kind=snack&sort=sales&pageSize=1')).data.list[0];
  const book = (await call('GET', '/products?kind=book&sort=sales&pageSize=1')).data.list[0];
  const detail = await call('GET', '/products/' + book.id);
  check('商品详情', detail.code === 0, detail.data.title + ' / SKU ' + detail.data.skus.length + ' 个');
  const reviewList = await call('GET', '/products/' + snack.id + '/reviews');
  check('评价与 AI 摘要', reviewList.code === 0, '评价 ' + reviewList.data.list.length + ' 条 / 摘要 ' + (reviewList.data.summary ? '有' : '无'));

  console.log('\n=== 4. 交易闭环 ===');
  const addr = await call('POST', '/addresses', { receiver: '验收同学', phone: '13800002222', campus: '验收楼', detail: '801' });
  check('新增地址', addr.code === 0, 'id=' + addr.data.id);
  const recharge = await call('POST', '/wallet/recharge', { amountCents: 10000 });
  check('模拟充值', recharge.code === 0, '余额 ' + (recharge.data.balanceCents / 100) + ' 元');
  await call('POST', '/cart', { productId: snack.id, quantity: 2 });
  await call('POST', '/cart', { productId: book.id, quantity: 1 });
  const cart = await call('GET', '/cart');
  check('购物车', cart.code === 0 && cart.data.totalQuantity === 3, cart.data.totalCount + ' 种 / ' + cart.data.totalQuantity + ' 件');
  const preview = await call('GET', '/orders/preview');
  check('结算预览', preview.code === 0, '应付 ' + (preview.data.payCents / 100) + ' 元');
  const order = await call('POST', '/orders', { addressId: addr.data.id, remark: '验收' });
  check('创建订单', order.code === 0, order.data.orderNo);
  const paid = await call('POST', '/orders/' + order.data.id + '/pay', { channel: 'balance' });
  check('余额支付', paid.code === 0 && paid.data.status === 'paid', '状态 ' + paid.data.status);
  const ship = await call('POST', '/admin/orders/' + order.data.id + '/ship', {}, true);
  check('管理端发货', ship.code === 0 && ship.data.status === 'shipped', '状态 ' + ship.data.status);
  const confirm = await call('POST', '/orders/' + order.data.id + '/confirm');
  check('确认收货', confirm.code === 0 && confirm.data.status === 'finished', '状态 ' + confirm.data.status);
  const itemId = order.data.items[0].id;
  const sale = await call('POST', '/after-sales', { orderItemId: itemId, reason: '不想要了', description: '验收', source: 'ai' });
  check('申请售后', sale.code === 0, sale.data.afterSaleNo + ' / ' + (sale.data.amountCents / 100) + ' 元');
  const audit = await call('POST', '/admin/after-sales/' + sale.data.id + '/audit', { approve: true, remark: '验收通过' }, true);
  check('审核退款', audit.code === 0 && audit.data.status === 'refunded', '状态 ' + audit.data.status);

  console.log('\n=== 5. AI 助手 ===');
  const status = await call('GET', '/ai/status');
  check('AI 工具注册表', status.code === 0 && status.data.tools.length >= 15, status.data.tools.length + ' 个工具，模式 ' + status.data.provider);
  const shopping = await call('POST', '/ai/chat/sync', { message: '想吃辣的，20 元以内', scene: 'shopping' });
  check('对话式导购', (shopping.data.cards || []).length > 0, '卡片 ' + shopping.data.cards.length + ' 张');
  const cartAction = await call('POST', '/ai/chat/sync', { message: '把第一个加购', conversationId: shopping.data.conversationId });
  const action = (cartAction.data.pendingActions || [])[0];
  check('写操作二次确认', Boolean(action), action && action.summary);
  const cartBefore = await call('GET', '/cart');
  const confirmed = await call('POST', '/ai/actions/' + action.actionId + '/confirm', { decision: 'confirm' });
  const cartAfter = await call('GET', '/cart');
  check('确认后才写入', confirmed.data.status === 'confirmed' && cartAfter.data.totalQuantity > cartBefore.data.totalQuantity,
    '加购前 ' + cartBefore.data.totalQuantity + ' 件 → 加购后 ' + cartAfter.data.totalQuantity + ' 件');
  const support = await call('POST', '/ai/chat/sync', { message: '退款多久能到账', scene: 'support' });
  check('客服 RAG 带引用', /根据《/.test(support.data.reply || ''), support.data.reply.slice(0, 46));
  const isbn = await call('POST', '/ai/chat/sync', { message: '扫一下 9787040396614', scene: 'shopping' });
  check('扫码找书', (isbn.data.cards || []).length > 0, (isbn.data.cards[0] || {}).title);
  const image = await call('POST', '/ai/chat/sync', { message: '我拍了张照片想找同款', scene: 'shopping' });
  check('拍照找同款降级', /ISBN|描述/.test(image.data.reply || ''), image.data.reply.slice(0, 40));
  const merchant = await call('POST', '/ai/chat/sync', { message: '最近生意怎么样', scene: 'merchant' }, true);
  check('商家侧经营分析', /订单/.test(merchant.data.reply || ''), merchant.data.reply.slice(0, 44));
  const copy = await call('POST', '/admin/ai/copywriting', { productId: snack.id, style: 'student' }, true);
  check('AI 文案生成', copy.code === 0 && copy.data.sellingPoints.length > 0, copy.data.title + ' / 模型 ' + copy.data.model);
  const calls = await call('GET', '/admin/ai/tool-calls?pageSize=5', undefined, true);
  check('工具调用可观测', calls.code === 0 && calls.data.total > 0, '累计 ' + calls.data.total + ' 次调用');
  const convs = await call('GET', '/admin/ai/conversations?pageSize=5', undefined, true);
  const replay = await call('GET', '/admin/ai/conversations/' + convs.data.list[0].id, undefined, true);
  check('会话可回放', replay.code === 0 && replay.data.messages.length > 0,
    replay.data.messages.length + ' 条消息 / ' + replay.data.toolCalls.length + ' 次工具调用');

  const failed = results.filter((r) => !r.ok);
  console.log('\n================================');
  console.log('验收合计 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + ' 项，失败 ' + failed.length + ' 项');
  if (failed.length) {
    console.log('失败项：' + failed.map((f) => f.name).join('、'));
    process.exit(1);
  }
  console.log('RESULT: 全链路验收通过');
}

main().catch((err) => {
  console.error('验收异常:', err && err.message);
  process.exit(1);
});
