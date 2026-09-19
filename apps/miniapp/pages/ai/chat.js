const api = require('../../utils/api');
const { streamChat } = require('../../utils/sse');
const { decorateProduct } = require('../../utils/format');
const { showError, setCartBadge, onImageError } = require('../../utils/ui');

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
    this.resetFallback();
    this.loadStatus();
  },

  onShow() {
    // 商品详情页「问 AI」会先写页面上下文，这里读出来带上，用户说「这个」才有指代
    this.pageContext = wx.getStorageSync('ai_page_context') || null;
    // 回到页面时兜底标记必须是干净的，否则第二条消息会被当成「已经兜底过」而直接丢弃
    this.resetFallback();
  },

  onUnload() {
    this.closeStream();
  },

  /**
   * 结束当前流：先作废序列号再 abort。
   * 否则已经发出的请求回到页面时会往 setData 里写「上一个消息数组」的下标，
   * 清空会话后这些写入会落到新消息上。
   */
  closeStream() {
    this.bumpSeq();
    if (this.task && this.task.abort) this.task.abort();
    this.task = null;
  },

  bumpSeq() {
    this.seq = (this.seq || 0) + 1;
    return this.seq;
  },

  /** 兜底（同步接口）的两个标记；不重置就会一直挡住后续消息，导致发送按钮永远禁用 */
  resetFallback() {
    this.fallbackRunning = false;
    this.fallbackDone = false;
  },

  async loadStatus() {
    try {
      const status = await api.aiStatus();
      this.setData({ statusText: status.mock ? '本地演示模式（未配置大模型 Key）' : '已接入 ' + status.model });
    } catch {
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
    // 键盘「发送」没有 disabled 属性，必须自己挡：并发两条流会互相覆盖 this.task
    if (this.data.sending) return;
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
    this.closeStream();
    this.resetFallback();
    this.conversationId = 0;
    this.setData({ messages: [], sending: false });
  },

  async send(text) {
    // 登录是异步的，这期间 sending 还没置位，必须再加一道同步闸，否则连点会起两条流
    if (this.data.sending || this.pending) return;
    this.resetFallback();
    this.pending = true;
    try {
      // 流式请求绕过了 utils/request 的统一封装，这里必须自己保证已登录，否则会带空 token 打到后端
      await api.ensureLogin().catch(() => null);
    } finally {
      this.pending = false;
    }

    const seq = this.bumpSeq();
    // 只发增量的两条消息，而不是把整个 messages 数组重发一遍
    const index = this.data.messages.length;
    const stamp = Date.now();
    const patch = {};
    patch['messages[' + index + ']'] = { key: 'u' + stamp, role: 'user', text };
    patch['messages[' + (index + 1) + ']'] = {
      key: 'a' + stamp, role: 'assistant', text: '', tools: [], cards: [], action: null, streaming: true,
    };
    patch.sending = true;
    const assistantIndex = index + 1;
    this.setData(patch, () => this.scrollToBottom());

    const payload = {
      message: text,
      scene: this.data.scene,
      conversationId: this.conversationId || undefined,
      pageContext: this.pageContext || undefined,
    };

    try {
      this.task = streamChat({
        url: '/ai/chat',
        data: payload,
        onEvent: (name, data) => this.runIfLive(seq, () => this.handleEvent(assistantIndex, name, data)),
        onFinish: () => this.runIfLive(seq, () => this.finish(assistantIndex)),
        onError: (err) => this.runIfLive(seq, () => this.fallbackSync(assistantIndex, payload, err)),
        onFallback: () => this.runIfLive(seq, () => this.fallbackSync(assistantIndex, payload)),
      });
    } catch (err) {
      // 连请求都没发出去（例如基础库异常）：不能让空气泡一直转，也不能让按钮卡死
      const patch = {};
      patch['messages[' + assistantIndex + '].text'] = '发送失败：' + ((err && err.message) || '未知错误');
      this.setData(patch);
      this.finish(assistantIndex);
      showError(err, '发送失败');
    }
  },

  /** 回调是否还属于当前这次会话：清空会话 / 离开页面后一律不再写数据 */
  runIfLive(seq, fn) {
    if (seq === this.seq) fn();
  },

  /** 基础库不支持分块传输 / 流式失败时的兜底：一次性拿完整结果，界面仍然可用 */
  async fallbackSync(assistantIndex, payload, streamError) {
    if (this.fallbackRunning || this.fallbackDone) return;
    this.fallbackRunning = true;
    const seq = this.seq;
    try {
      const result = await api.aiChatSync(payload);
      if (seq !== this.seq) return;
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
      if (seq !== this.seq) return;
      const reason = (streamError && streamError.message) || (err && err.message) || '连接后端失败';
      const patch = {};
      patch['messages[' + assistantIndex + '].text'] = '抱歉，' + reason + '。请稍后重试。';
      this.setData(patch);
    } finally {
      this.fallbackRunning = false;
      if (seq === this.seq) this.finish(assistantIndex);
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
      // done 只带会话 id，没有任何要渲染的字段，不必再 setData 一次
      if (payload.conversationId) this.conversationId = payload.conversationId;
      return;
    }

    if (!Object.keys(patch).length) return;
    this.setData(patch, () => this.scrollToBottom());
  },

  finish(index) {
    const patch = {};
    patch['messages[' + index + '].streaming'] = false;
    patch.sending = false;
    this.setData(patch, () => this.scrollToBottom());
  },

  /** 写操作二次确认：用户点确认后才真正加购 / 提交售后 */
  async confirmAction(e) {
    if (this.confirming) return; // 连点两次会发出两个确认请求，第二次必然报「已处理」
    this.confirming = true;
    const { id, decision, index } = e.currentTarget.dataset;
    try {
      const result = await api.confirmAction(Number(id), decision);
      const patch = {};
      patch['messages[' + index + '].action'] = {
        id: Number(id),
        summary: result.summary,
        status: result.status,
        message: result.message,
      };
      if (result.cards && result.cards.length) {
        // 和流式路径一样过一遍 decorateProduct，否则确认后的卡片价格是空的
        patch['messages[' + index + '].cards'] = (this.data.messages[index].cards || []).concat(result.cards.map(decorateProduct));
      }
      this.setData(patch);
      wx.showToast({ title: decision === 'confirm' ? '已执行' : '已取消', icon: 'none' });
      if (decision === 'confirm' && result.status === 'confirmed') {
        const cart = await api.cart().catch(() => null);
        if (cart && cart.totalQuantity > 0) setCartBadge(cart.totalQuantity);
      }
    } catch (err) {
      showError(err, '操作失败，请重试');
    } finally {
      this.confirming = false;
    }
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product/detail?id=' + e.currentTarget.dataset.id });
  },

  onImageError: onImageError,

  scrollToBottom() {
    const messages = this.data.messages;
    if (!messages.length) return;
    this.setData({ scrollTo: 'msg-' + (messages.length - 1) });
  },
});
