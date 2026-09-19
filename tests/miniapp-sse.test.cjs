/**
 * SSE 客户端单测（Node 环境跑，用桩替代 wx API）。
 * 重点验证两件最容易出问题的事：
 *   1. 一个汉字被切在两个 chunk 里时能否正确拼回（增量 UTF-8 解码）
 *   2. SSE 帧可能跨 chunk 断开时能否正确切帧
 */
let chunkHandler = null;
let captured = null;

global.wx = {
  getStorageSync: () => 'test-token',
  request(options) {
    captured = options;
    return {
      onChunkReceived(cb) { chunkHandler = cb; },
      abort() {},
    };
  },
};

const { streamChat } = require('../apps/miniapp/utils/sse');

const frames = [
  'event: tool_start\ndata: {"type":"tool_start","toolName":"search_products","label":"正在检索商品"}\n\n',
  'event: cards\ndata: {"type":"cards","products":[{"id":1,"title":"卫龙辣条","priceCents":350}]}\n\n',
  'event: text\ndata: {"type":"text","delta":"给你挑了 1 件：卫龙辣条"}\n\n',
  'event: done\ndata: {"type":"done","conversationId":7,"messageId":9}\n\n',
].join('');

const events = [];
let finished = false;
let reply = '';

streamChat({
  url: '/ai/chat',
  data: { message: '想吃辣的' },
  onEvent(name, payload) {
    events.push(name);
    if (name === 'text') reply += payload.delta;
  },
  onFinish() { finished = true; },
});

if (!captured.enableChunked) throw new Error('没有开启 enableChunked');

// 故意在汉字中间切开，并让一帧跨两个 chunk
const bytes = Buffer.from(frames, 'utf8');
const cutCharIndex = frames.indexOf('辣');
const cutAt = Buffer.byteLength(frames.slice(0, cutCharIndex), 'utf8') + 1;
const parts = [bytes.slice(0, cutAt), bytes.slice(cutAt, cutAt + 7), bytes.slice(cutAt + 7)];
for (const part of parts) {
  chunkHandler({ data: part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) });
}
captured.success({});

const assert = require('node:assert');
assert.deepStrictEqual(events, ['tool_start', 'cards', 'text', 'done'], '事件序列不正确: ' + events.join(','));
assert.strictEqual(reply, '给你挑了 1 件：卫龙辣条', '流式文本拼接不正确: ' + reply);
assert.ok(finished, 'onFinish 未触发');
console.log('事件序列 :', events.join(' → '));
console.log('拼接文本 :', reply);
console.log('RESULT: SSE 客户端（含跨 chunk 汉字解码）验证通过');