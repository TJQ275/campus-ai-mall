/**
 * 小程序 API 层集成测试：用 Node 桩替换 wx.request，真实打后端。
 * 跑通「登录 → 浏览 → 加购 → 下单 → 支付 → 售后」全链路，验证小程序侧的接口封装没有问题。
 */
const store = {};
let loginCount = 0;
global.getCurrentPages = () => [];

global.wx = {
  getStorageSync: (k) => store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  showToast: () => {},
  login: ({ success }) => { loginCount += 1; success({ code: 'miniapp-test-' + Date.now() }); },
  reLaunch: ({ url }) => { store.__redirect = url; },
  switchTab: ({ url }) => { store.__redirect = url; },
  request(options) {
    const url = options.url + (options.method === 'GET' || !options.data ? buildQuery(options.data) : '');
    const init = {
      method: options.method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json' }, options.header || {}),
    };
    if (options.method && options.method !== 'GET' && options.data) init.body = JSON.stringify(options.data);
    fetch(url, init)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        options.success && options.success({ statusCode: res.status, data: body });
      })
      .catch((err) => options.fail && options.fail(err));
    return { onChunkReceived() {}, abort() {} };
  },
};

function buildQuery(data) {
  if (!data) return '';
  const parts = Object.keys(data)
    .filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== '')
    .map((k) => k + '=' + encodeURIComponent(data[k]));
  return parts.length ? '?' + parts.join('&') : '';
}

const api = require('../apps/miniapp/utils/api');
const { yuan } = require('../apps/miniapp/utils/format');

const results = [];
const check = (name, ok, detail) => results.push((ok ? 'PASS ' : 'FAIL ') + name + ' — ' + detail);

async function main() {
  // 1. 主动登录（不再静默建号，见 tests/miniapp-auth.test.cjs）
  const code = await new Promise((resolve) => wx.login({ success: (res) => resolve(res.code) }));
  const session = await api.wxLogin(code, { nickname: '集成测试同学' });
  api.setupSession(session);
  const token = api.getToken();
  check('主动登录', Boolean(token) && loginCount === 1, 'wx.login 调用 ' + loginCount + ' 次，昵称 ' + session.user.nickname);
  const me = await api.me();
  check('获取用户', Boolean(me && me.id), '昵称 ' + me.nickname + '，角色 ' + session.user.role);

  // 2. 浏览
  const home = await api.home();
  check('首页聚合', (home.hot || []).length > 0 && (home.recommend || []).length > 0,
    '热销 ' + home.hot.length + ' / 推荐 ' + home.recommend.length + ' / 策略 ' + home.recommendStrategy);
  const cats = await api.categories('book');
  check('分类', (cats || []).length > 0, '二手书分类 ' + cats.length + ' 个');
  const list = await api.products({ kind: 'snack', sort: 'sales', pageSize: 3 });
  check('商品列表', (list.list || []).length === 3, '返回 3 条，共 ' + list.total + ' 条');
  const detail = await api.productDetail(list.list[0].id);
  check('商品详情', Boolean(detail.id), detail.title + ' ' + yuan(detail.priceCents));
  const reviews = await api.reviews(list.list[0].id);
  check('评论与摘要', Array.isArray(reviews.list), '评论 ' + reviews.list.length + ' 条，摘要 ' + (reviews.summary ? '有' : '无'));

  // 3. 购物车
  await api.addCart(detail.id, 2);
  const cart = await api.cart();
  check('加入购物车', cart.totalQuantity === 2, cart.totalCount + ' 种 / ' + cart.totalQuantity + ' 件 / ' + yuan(cart.totalCents));

  // 4. 下单（先补地址）
  let addresses = await api.addresses();
  if (!addresses.length) {
    await api.createAddress({ receiver: '测试同学', phone: '13800001111', campus: '测试楼', detail: '101' });
    addresses = await api.addresses();
  }
  check('收货地址', addresses.length > 0, addresses.length + ' 个地址');
  const preview = await api.orderPreview();
  check('结算预览', preview.payCents > 0, '应付 ' + yuan(preview.payCents) + '，配送费 ' + yuan(preview.freightCents));
  const recharge = await api.recharge(5000);
  check('模拟充值', recharge.balanceCents >= 5000, '余额 ' + yuan(recharge.balanceCents));
  const order = await api.createOrder({ addressId: addresses[0].id, remark: '小程序集成测试' });
  check('创建订单', Boolean(order.id), order.orderNo);
  const paid = await api.payOrder(order.id, 'balance');
  check('余额支付', paid.status === 'paid', '状态 ' + paid.status);
  const orders = await api.orders('all');
  check('订单列表（分页）', (orders.list || []).length > 0 && orders.total > 0 && orders.pageSize > 0,
    '本页 ' + orders.list.length + ' 笔 / 共 ' + orders.total + ' 笔（每页 ' + orders.pageSize + '）');
  const summary = await api.orderSummary();
  check('订单角标统计', summary.all === orders.total && typeof summary.pending_pay === 'number',
    '全部 ' + summary.all + ' / 待付款 ' + summary.pending_pay + ' / 待发货 ' + summary.paid);
  const orderDetail = await api.orderDetail(order.id);
  check('订单详情', (orderDetail.items || []).length > 0, orderDetail.items.length + ' 个商品，状态 ' + orderDetail.status);

  // 5. 售后
  const sale = await api.applyAfterSale({
    orderItemId: orderDetail.items[0].id, reason: '不想要了', description: '小程序集成测试', type: 'refund',
  });
  check('申请售后', Boolean(sale.id), sale.afterSaleNo + ' / ' + yuan(sale.amountCents));
  const sales = await api.afterSales();
  check('售后列表', sales.length > 0, '共 ' + sales.length + ' 单');

  // 6. AI 助手（同步接口，流式接口已在 sse.test.cjs 验证）
  const status = await api.aiStatus();
  check('AI 状态', Boolean(status.provider), status.provider + ' / ' + (status.mock ? '降级模式' : status.model) + ' / 工具 ' + status.tools.length + ' 个');
  const chat = await api.aiChatSync({ message: '想吃辣的，20 元以内', scene: 'shopping' });
  check('AI 对话', (chat.cards || []).length > 0, '卡片 ' + chat.cards.length + ' 张，回复「' + String(chat.reply).slice(0, 20) + '…」');
  const chat2 = await api.aiChatSync({ message: '把第一个加购', conversationId: chat.conversationId });
  const action = (chat2.pendingActions || [])[0];
  check('写操作待确认', Boolean(action), action ? action.summary : '未生成确认动作');
  const confirmed = await api.confirmAction(action.actionId, 'confirm');
  check('确认后执行', confirmed.status === 'confirmed', confirmed.message);

  // 7. 钱包
  const wallet = await api.wallet();
  check('钱包余额', typeof wallet.balanceCents === 'number', yuan(wallet.balanceCents));

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.indexOf('FAIL') === 0).length;
  console.log('\n合计 ' + results.length + ' 项，失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('测试异常:', err && err.message);
  process.exit(1);
});