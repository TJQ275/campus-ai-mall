/**
 * 小程序端 SSE 客户端。
 *
 * 微信小程序没有 EventSource，只能用 wx.request 的 enableChunked + onChunkReceived 收分块，
 * 而且拿到的是 ArrayBuffer —— 需要自己做 UTF-8 增量解码（一个汉字可能被切在两个 chunk 里）。
 * 这里把两件事都封装好，页面只关心事件回调。
 */

/** 流式响应最长等待时间：卡住的连接不能一直占着发送按钮 */
const STREAM_TIMEOUT = 60000;

function createUtf8Decoder() {
  let pending = [];
  return function decode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const all = pending.concat(Array.prototype.slice.call(bytes));
    let out = '';
    let i = 0;
    while (i < all.length) {
      const b = all[i];
      // 下面每个分支都会赋值，初始值用不上
      let need;
      let code;
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
 * @param {object} options { url, data, onEvent(eventName, payload), onFinish(), onError(err), onFallback() }
 * @returns {object} 句柄，可调用 abort() 主动结束（离开页面 / 新会话时用）
 */
function streamChat(options) {
  const { BASE_URL } = require('../config');
  const decode = createUtf8Decoder();
  let buffer = '';
  let settled = false;
  let timer = null;

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
    } catch {
      /* 半截 JSON 直接丢弃，等下一帧 */
    }
  };

  const finishOnce = () => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    options.onFinish && options.onFinish();
  };

  const errorOnce = (err) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    options.onError && options.onError(err);
  };

  const task = wx.request({
    url: BASE_URL + options.url,
    method: 'POST',
    data: options.data,
    timeout: STREAM_TIMEOUT + 5000,
    header: {
      'content-type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer ' + (wx.getStorageSync('token') || ''),
    },
    enableChunked: true,
    responseType: 'arraybuffer',
    success(res) {
      // 后端在鉴权失败时返回的是普通 JSON，没有 SSE 帧分隔符：
      // 只靠 handleFrame 是收不到任何东西的，必须在这里看状态码，否则用户只会看到一个空气泡。
      const status = res.statusCode || 0;
      const body = res.data;
      if (status === 401) {
        // 清掉过期 token，下一个请求（含兜底的同步接口）会重新登录
        wx.removeStorageSync('token');
        errorOnce(new Error('登录已过期，请重新发送'));
        return;
      }
      if (status >= 400) {
        errorOnce(new Error((body && body.message) || 'AI 服务异常（' + status + '）'));
        return;
      }
      if (body && typeof body.code === 'number' && body.code !== 0) {
        errorOnce(new Error(body.message || 'AI 服务异常'));
        return;
      }
      if (buffer.trim()) handleFrame(buffer);
      finishOnce();
    },
    fail(err) {
      errorOnce(new Error((err && err.errMsg) || '网络异常，请重试'));
    },
  });

  // 卡住的流：超时后主动断开并抛错，界面不会永远停在「正在思考…」
  timer = setTimeout(() => {
    settled = true;
    if (task && task.abort) task.abort();
    options.onError && options.onError(new Error('响应超时，请重试'));
  }, STREAM_TIMEOUT);

  if (task && task.onChunkReceived) {
    task.onChunkReceived((res) => {
      if (settled) return;
      // 帧分隔符可能是 \n\n 也可能是 \r\n\r\n，且 \r 和 \n 可能被切在两个 chunk 里，
      // 所以每次拼完整块后再整体归一化
      buffer = (buffer + decode(res.data)).replace(/\r\n/g, '\n');
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

  return {
    abort() {
      // 主动结束：置位后回调一律不再触发，避免页面已经离开/已经新开会话时还去 setData
      settled = true;
      if (timer) clearTimeout(timer);
      if (task && task.abort) task.abort();
    },
  };
}

module.exports = { streamChat };
