/**
 * 小程序端 SSE 客户端。
 *
 * 微信小程序没有 EventSource，只能用 wx.request 的 enableChunked + onChunkReceived 收分块，
 * 而且拿到的是 ArrayBuffer —— 需要自己做 UTF-8 增量解码（一个汉字可能被切在两个 chunk 里）。
 * 这里把两件事都封装好，页面只关心事件回调。
 */

function createUtf8Decoder() {
  let pending = [];
  return function decode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const all = pending.concat(Array.prototype.slice.call(bytes));
    let out = '';
    let i = 0;
    while (i < all.length) {
      const b = all[i];
      let need = 0;
      let code = 0;
      if (b < 0x80) { need = 1; code = b; }
      else if ((b & 0xe0) === 0xc0) { need = 2; code = b & 0x1f; }
      else if ((b & 0xf0) === 0xe0) { need = 3; code = b & 0x0f; }
      else if ((b & 0xf8) === 0xf0) { need = 4; code = b & 0x07; }
      else { i += 1; continue; }
      if (i + need > all.length) break;
      for (let k = 1; k < need; k += 1) code = (code << 6) | (all[i + k] & 0x3f);
      out += String.fromCodePoint(code);
      i += need;
    }
    pending = all.slice(i);
    return out;
  };
}

/**
 * 发起流式对话。
 * @param {object} options { url, data, onEvent(eventName, payload), onFinish(), onError(err) }
 * @returns 请求 task，可调用 abort()
 */
function streamChat(options) {
  const { BASE_URL } = require('../config');
  const decode = createUtf8Decoder();
  let buffer = '';

  const handleFrame = (frame) => {
    const lines = frame.split('\n');
    let eventName = 'message';
    const dataLines = [];
    lines.forEach((line) => {
      if (line.indexOf('event:') === 0) eventName = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
    });
    if (!dataLines.length) return;
    try {
      options.onEvent(eventName, JSON.parse(dataLines.join('')));
    } catch (err) {
      /* 半截 JSON 直接丢弃，等下一帧 */
    }
  };

  const task = wx.request({
    url: BASE_URL + options.url,
    method: 'POST',
    data: options.data,
    header: {
      'content-type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer ' + (wx.getStorageSync('token') || ''),
    },
    enableChunked: true,
    responseType: 'arraybuffer',
    success() {
      if (buffer.trim()) handleFrame(buffer);
      options.onFinish && options.onFinish();
    },
    fail(err) {
      options.onError && options.onError(err);
    },
  });

  if (task && task.onChunkReceived) {
    task.onChunkReceived((res) => {
      buffer += decode(res.data);
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (frame.trim()) handleFrame(frame);
        index = buffer.indexOf('\n\n');
      }
    });
  } else {
    // 基础库过低不支持分块：退回到一次性返回，页面仍然可用
    options.onFallback && options.onFallback();
  }

  return task;
}

module.exports = { streamChat };
