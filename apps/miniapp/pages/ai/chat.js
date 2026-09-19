const api = require('../../utils/api');
const { streamChat } = require('../../utils/sse');
const { decorateProduct } = require('../../utils/format');

Page({
  data: {
    messages: [],
    input: '',
    scene: 'shopping',
    sending: false,
    scrollTo: '',
    statusText: '',
    quickAsks: ['想吃辣的，20 元以内', '有高数教材吗', '退款多久到账', '我的订单到哪了'],
  },

  onLoad() {
    this.conversationId = 0;
    this.loadStatus();
  },

  onShow() {
    // 商品详情页「问 AI」会先写页面上下文，这里读出来带上，用户说「这个」才有指代
    this.pageContext = wx.getStorageSync('ai_page_context') || null;
  },

  async loadStatus() {
    try {
      const status = await api.aiStatus();
      this.setData({ statusText: status.mock ? '本地演示模式（未配置大模型 Key）' : '已接入 ' + status.model });
    } catch (err) {
      this.setData({ statusText: '后端未连接' });
    }
  },

  switchScene(e) {
    this.setData({ scene: e.currentTarget.dataset.scene });
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  askQuick(text) {
    if (this.data.sending) return;
    this.send(text);
  },

  onQuickTap(e) {
    this.askQuick(e.currentTarget.dataset.q);
  },

  sendFromInput() {
    const text = (this.data.input || '').trim();
    if (!text) return;
    this.setData({ input: '' });
    this.send(text);
  },

  /** 扫码找书：把 ISBN 当成一句话发给助手，走 search_by_isbn 工具 */
  scanBook() {
    wx.scanCode({
      scanType: ['barCode'],
      success: (res) => {
        const isbn = (res.result || '').replace(/[^0-9Xx]/g, '');
        if (isbn) this.send('扫一下 ' + isbn);
      },
    });
  },

  newChat() {
    this.conversationId = 0;
    this.setData({ messages: [] });
  },

  async send(text) {
    // 流式请求绕过了 utils/request 的统一封装，这里必须自己保证已登录，否则会带空 token 打到后端
    await api.ensureLogin().catch(() => null);
    const messages = this.data.messages.concat([
      { key: 'u' + Date.now(), role: 'user', text },
      { key: 'a' + Date.now(), role: 'assistant', text: '', tools: [], cards: [], action: null, streaming: true },
    ]);
    const assistantIndex = messages.length - 1;
    this.setData({ messages, sending: true }, () => this.scrollToBottom());

    const payload = {
      message: text,
      scene: this.data.scene,
      conversationId: this.conversationId || undefined,
      pageContext: this.pageContext || undefined,
    };

    this.task = streamChat({
      url: '/ai/chat',
      data: payload,
      onEvent: (name, data) => this.handleEvent(assistantIndex, name, data),
      onFinish: () => this.finish(assistantIndex, payload),
      onError: () => this.fallbackSync(assistantIndex, payload),
      onFallback: () => this.fallbackSync(assistantIndex, payload),
    });
  },

  /** 基础库不支持分块传输时的兜底：一次性拿完整结果，界面仍然可用 */
  async fallbackSync(assistantIndex, payload) {
    if (this.fallbackRunning || this.fallbackDone) return;
    this.fallbackRunning = true;
    try {
      const result = await api.aiChatSync(payload);
      this.conversationId = result.conversationId || this.conversationId;
      const patch = {};
      patch['messages[' + assistantIndex + '].text'] = this.data.messages[assistantIndex].text || result.reply || '';
      patch['messages[' + assistantIndex + '].cards'] = (result.cards || []).map(decorateProduct);
      const actions = result.pendingActions || [];
      if (actions.length) {
        patch['messages[' + assistantIndex + '].action'] = { id: actions[0].actionId, summary: actions[0].summary, status: 'pending' };
      }
      this.fallbackDone = true;
      this.setData(patch);
    } catch (err) {
      const patch = {};
      patch['messages[' + assistantIndex + '].text'] = '抱歉，连接后端失败，请确认服务已启动。';
      this.setData(patch);
    } finally {
      this.fallbackRunning = false;
      this.finish(assistantIndex);
    }
  },

  handleEvent(index, name, payload) {
    const patch = {};
    const base = 'messages[' + index + ']';
    const current = this.data.messages[index] || {};

    if (name === 'text') {
      patch[base + '.text'] = (current.text || '') + (payload.delta || '');
    } else if (name === 'tool_start') {
      patch[base + '.tools'] = (current.tools || []).concat([
        { name: payload.toolName, label: payload.label, brief: '', ok: true, running: true },
      ]);
    } else if (name === 'tool_result') {
      const tools = (current.tools || []).slice();
      if (tools.length) {
        tools[tools.length - 1] = Object.assign({}, tools[tools.length - 1], {
          brief: payload.brief, ok: payload.ok, running: false,
        });
      }
      patch[base + '.tools'] = tools;
    } else if (name === 'cards') {
      patch[base + '.cards'] = (current.cards || []).concat((payload.products || []).map(decorateProduct));
    } else if (name === 'action_confirm') {
      patch[base + '.action'] = { id: payload.actionId, summary: payload.summary, status: 'pending' };
    } else if (name === 'usage') {
      patch[base + '.meta'] = (payload.degraded ? '本地演示模式 · ' : '') + payload.model + ' · ' + payload.latencyMs + 'ms';
    } else if (name === 'error') {
      patch[base + '.text'] = (current.text || '') + ' [出错了] ' + payload.message;
    } else if (name === 'done') {
      if (payload.conversationId) this.conversationId = payload.conversationId;
    }

    this.setData(patch, () => this.scrollToBottom());
  },

  finish(index) {
    const patch = {};
    patch['messages[' + index + '].streaming'] = false;
    this.setData(patch);
    this.setData({ sending: false }, () => this.scrollToBottom());
  },

  /** 写操作二次确认：用户点确认后才真正加购 / 提交售后 */
  async confirmAction(e) {
    const { id, decision, index } = e.currentTarget.dataset;
    const result = await api.confirmAction(Number(id), decision);
    const patch = {};
    patch['messages[' + index + '].action'] = {
      id: Number(id),
      summary: result.summary,
      status: result.status,
      message: result.message,
    };
    if (result.cards && result.cards.length) {
      patch['messages[' + index + '].cards'] = (this.data.messages[index].cards || []).concat(result.cards);
    }
    this.setData(patch);
    wx.showToast({ title: decision === 'confirm' ? '已执行' : '已取消', icon: 'none' });
    if (decision === 'confirm' && result.status === 'confirmed') {
      const cart = await api.cart().catch(() => null);
      if (cart && cart.totalQuantity > 0) wx.setTabBarBadge({ index: 2, text: String(cart.totalQuantity) });
    }
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.id });
  },

  scrollToBottom() {
    const messages = this.data.messages;
    if (!messages.length) return;
    this.setData({ scrollTo: 'msg-' + (messages.length - 1) });
  },
});