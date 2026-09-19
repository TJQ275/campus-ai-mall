import { emptyUsage, type ChatMessage, type ChatResult, type LlmProvider, type LlmToolCall, type StreamChunk, type ToolSpec } from './types.js';

/**
 * 无 Key 降级用的本地「假模型」。
 *
 * 它不是空壳：会用规则解析用户意图（预算 / 辣度 / 品类 / 课程 / 订单），
 * 产出一条与真实 Function Calling 完全同构的 tool_call，等工具结果回来后再拼一段人话总结。
 * 因此没有配置 LLM_API_KEY 时，「对话 → 调工具 → 商品卡片 → 加购确认」整条链路依然完整可演示。
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-rule-based';
  readonly isMock = true;

  async chat(messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): Promise<ChatResult> {
    let result: ChatResult | null = null;
    for await (const chunk of this.chatStream(messages, tools, signal)) {
      if (chunk.type === 'done') result = chunk.result;
    }
    return result ?? { content: '', toolCalls: [], usage: emptyUsage(), model: this.model, degraded: true };
  }

  async *chatStream(messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
    // 客户端已断开就不用继续「假流式」了
    if (signal?.aborted) return;
    const last = messages[messages.length - 1];
    const available = new Set(tools.map((t) => t.name));

    // 第二种情况：上一步是工具结果 → 说人话总结
    if (last?.role === 'tool') {
      const text = this.summarize(last.name ?? '', last.content);
      for (const piece of chunkText(text)) yield { type: 'text', delta: piece };
      yield { type: 'done', result: { content: text, toolCalls: [], usage: emptyUsage(), model: this.model, degraded: true } };
      return;
    }

    const userText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const call = this.decide(userText, messages, available);
    yield {
      type: 'done',
      result: {
        content: '',
        toolCalls: call ? [call] : [],
        usage: emptyUsage(),
        model: this.model,
        degraded: true,
      },
    };
  }

  /** 规则意图解析 → 选一个工具 */
  private decide(text: string, messages: ChatMessage[], available: Set<string>): LlmToolCall | null {
    const id = 'mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const call = (name: string, args: Record<string, unknown>): LlmToolCall | null =>
      available.has(name) ? { id, name, arguments: args, rawArguments: JSON.stringify(args) } : null;

    // ── 商家侧意图 ──
    if (/(文案|卖点|详情页|写一段|推广语|标题怎么写)/.test(text)) return call('generate_copywriting', {});
    if (/(卖得最好|热销|销量排行|排行|趋势|退款统计|用户增长|AI ?促成|环比|数据)/.test(text)) {
      const metric = /热销|卖得最好|排行/.test(text)
        ? 'top_products'
        : /趋势/.test(text)
          ? 'sales_trend'
          : /退款/.test(text)
            ? 'refund_stats'
            : /用户/.test(text)
              ? 'user_growth'
              : /AI ?促成/.test(text)
                ? 'ai_orders'
                : 'category_sales';
      return call('query_business_data', { metric });
    }
    if (/(生意|经营|营收|销售额|最近怎么样|整体情况|概览)/.test(text)) return call('get_business_overview', {});

    if (/(退款政策|怎么退|能退吗|政策|规则|多久到账|多久能到|时效|配送|运费|优惠券|回收|成色|流程|发票|开票)/.test(text)) {
      return call('search_knowledge', { query: text });
    }
    const isbn = /(\d[\d\-\s]{9,17}[\dXx])/.exec(text)?.[1]?.replace(/[^0-9Xx]/g, '');
    if (isbn && isbn.length >= 10) return call('search_by_isbn', { isbn });
    if (/(拍照|照片|图片|拍了一张|拍下来|同款)/.test(text)) {
      // 只有用户真的描述了画面内容才传 description，否则走 search_by_image 的降级分支
      const described = /(?:图片|照片|拍)[^，。]{0,8}(?:是|有|为)([^，。！？]{2,20})/.exec(text)?.[1]?.trim();
      return call('search_by_image', described ? { description: described } : {});
    }
    if (/购物车/.test(text)) return call('get_cart', {});
    if (/(我的|查|看).{0,4}订单|订单(到哪|状态)|发货|物流/.test(text)) return call('get_my_orders', {});
    if (/(退款|退货|退掉|退了|退一下|售后|不想要了)/.test(text)) return call('get_my_orders', {});
    if (/(我(喜欢|爱)吃|口味|忌口|过敏)/.test(text)) return call('get_user_profile', {});

    // 「加购」类指令：从上一轮助手给出的卡片里取第一件商品
    if (/(加购|加入购物车|来一?[份个包箱]|买了|下单)/.test(text)) {
      const lastCards = this.lastCards(messages);
      if (lastCards.length) {
        const first = lastCards[0];
        return call('add_to_cart', { productId: first.productId, quantity: 1 });
      }
    }

    const args = this.parseSearch(text);
    return call('search_products', args);
  }

  /** 从历史消息里找最近一次商品卡片 */
  private lastCards(messages: ChatMessage[]): { productId: number; title: string }[] {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const raw = messages[i].content ?? '';
      if (!raw) continue;

      // 情况一：消息里嵌了 JSON（工具结果）
      if (raw.includes('productId')) {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) {
          try {
            const parsed = JSON.parse(raw.slice(start, end + 1)) as {
              cards?: { productId: number; title: string }[];
              items?: { productId: number; title: string }[];
              productId?: number;
              title?: string;
            };
            if (parsed.cards?.length) return parsed.cards;
            if (parsed.items?.length) return parsed.items.filter((x) => x.productId);
            if (parsed.productId) return [{ productId: parsed.productId, title: parsed.title ?? '当前商品' }];
          } catch { /* 继续找标记 */ }
        }
      }

      // 情况二：助手消息尾部的「已展示商品」标记
      const marked = /已展示商品[:：]\s*([^\]\n]+)/.exec(raw);
      if (marked) {
        const items = marked[1]
          .split('|')
          .map((piece) => /(\d+)\s*[:：]\s*(.+)/.exec(piece.trim()))
          .filter((m): m is RegExpExecArray => Boolean(m))
          .map((m) => ({ productId: Number(m[1]), title: m[2].trim() }));
        if (items.length) return items;
      }
    }
    return [];
  }

  private parseSearch(text: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    const budget = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|块钱)?\s*(?:以内|以下|左右|封顶)/) ?? text.match(/(\d+(?:\.\d+)?)\s*(?:元|块)/);
    if (budget) args.priceMax = Number(budget[1]);

    const bookWords = /(书|教材|课本|复习|考研|四级|六级|真题|笔记)/;
    const snackWords = /(吃|零食|辣条|薯片|饮料|泡面|坚果|饼干|面包|牛奶|饿了|夜宵)/;
    if (bookWords.test(text) && !snackWords.test(text)) args.kind = 'book';
    else if (snackWords.test(text)) args.kind = 'snack';

    const courses: [RegExp, string][] = [
      [/高数|高等数学/, '高等数学'],
      [/线代|线性代数/, '线性代数'],
      [/概率论|数理统计/, '概率论'],
      [/数据结构/, '数据结构'],
      [/计算机网络/, '计算机网络'],
      [/操作系统/, '操作系统'],
      [/四级/, '大学英语'],
      [/六级/, '大学英语'],
      [/考研数学/, '考研数学'],
      [/考研政治/, '考研政治'],
      [/C\s*语言/i, 'C 语言'],
    ];
    for (const [pattern, course] of courses) {
      if (pattern.test(text)) { args.course = course; break; }
    }

    const tags: string[] = [];
    if (/辣|重口|过瘾/.test(text)) tags.push('辣');
    if (/甜|甜品/.test(text)) tags.push('甜');
    if (/咸/.test(text)) tags.push('咸');
    if (/夜宵|熬夜|晚上/.test(text)) tags.push('熬夜续命');
    if (/宿舍|囤/.test(text)) tags.push('宿舍必备');
    if (/便宜|省钱|预算|学生党/.test(text)) tags.push('预算友好');
    if (tags.length) args.tags = tags.slice(0, 2);

    if (/不辣|清淡|不能吃辣/.test(text)) {
      delete args.tags;
      args.keyword = args.kind === 'book' ? undefined : '薯片';
    }

    if (args.kind === 'book' && !args.course && !args.keyword) args.keyword = '教材';
    if (!Object.keys(args).length) args.keyword = text.slice(0, 12);
    return JSON.parse(JSON.stringify(args));
  }

  /** 工具结果 → 人话。没有真实模型时，这段话术决定演示观感 */
  private summarize(toolName: string, rawContent: string): string {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(rawContent) as Record<string, unknown>; } catch { /* 保持空对象 */ }

    if (toolName === 'search_products') {
      const items = (payload.items ?? []) as { title: string; priceCents: number; tags?: string[] }[];
      if (!items.length) return '按这个条件没找到合适的商品。要不要放宽一点预算，或者换个口味试试？';
      const lines = items.slice(0, 3).map((i) => '「' + i.title + '」' + formatYuan(i.priceCents));
      return '给你挑了 ' + items.length + ' 件：' + lines.join('、') + '。点下面的卡片可以直接加入购物车，或者告诉我更具体的口味。';
    }
    if (toolName === 'get_cart') {
      const count = Number(payload.totalCount ?? 0);
      if (!count) return '你的购物车还是空的。要不要我按你的口味推荐几样？';
      return '购物车里现在有 ' + count + ' 件商品，合计 ' + formatYuan(Number(payload.totalCents ?? 0)) + (Number(payload.freightCents ?? 0) > 0 ? '，再加一点就能免配送费了。' : '，已经免配送费。');
    }
    if (toolName === 'get_my_orders') {
      const list = (payload.orders ?? []) as { orderNo: string; status: string; payCents: number }[];
      if (!list.length) return '你还没有相关订单。';
      return '查到 ' + list.length + ' 笔订单，最近一笔 ' + list[0].orderNo + '（' + statusLabel(list[0].status) + '，' + formatYuan(list[0].payCents) + '）。需要我帮你处理哪一笔？';
    }
    if (toolName === 'get_user_profile') {
      const taste = (payload.taste ?? {}) as Record<string, unknown>;
      const avoid = (payload.avoidTags ?? []) as string[];
      return '我记得你的口味：辣度偏好 ' + (taste.spicy ?? '未记录') + '，' + (avoid.length ? '忌口：' + avoid.join('、') + '。' : '暂时没有忌口记录。') + '可以直接说想吃什么，我来配。';
    }
    if (payload.status === 'pending_user_confirmation') {
      return '已经准备好了：' + String(payload.summary ?? '') + '。点下面的确认按钮就生效，不想加也没关系。';
    }
    if (toolName === 'get_business_overview') {
      const kpi = (payload.kpi ?? {}) as Record<string, unknown>;
      return '目前共 ' + String(kpi.order_count ?? 0) + ' 笔订单、成交 ' + String(kpi.paid ?? '¥0.00') + '，待处理售后 ' + String(kpi.pending_after_sale ?? 0) + ' 单，其中 AI 助手促成的订单占 ' + String(kpi.aiOrderRatio ?? '0%') + '。要不要我再看某个指标的趋势？';
    }
    if (toolName === 'query_business_data') {
      const list = (payload.list ?? []) as Record<string, unknown>[];
      const metric = String(payload.metric ?? '');
      if (!list.length) return '这个区间还没有数据。';
      if (metric === 'top_products') {
        return '卖得最好的是：' + list.slice(0, 3).map((r) => String(r.title) + '（' + String(r.qty) + ' 件）').join('、') + '。';
      }
      if (metric === 'ai_orders') {
        return '订单来源分布：' + list.map((r) => (r.source === 'ai' ? 'AI 助手 ' : '用户自主 ') + String(r.count) + ' 单').join('、') + '。';
      }
      if (metric === 'refund_stats') {
        return '售后情况：' + list.map((r) => String(r.status) + ' ' + String(r.count) + ' 单').join('、') + '。';
      }
      return '统计结果（' + metric + '）：' + list.slice(0, 5).map((r) => JSON.stringify(r)).join('、').slice(0, 120) + '。';
    }
    if (toolName === 'generate_copywriting') {
      if (payload.needProduct) return String(payload.hint ?? '请先告诉我商品。');
      const points = (payload.sellingPoints ?? []) as string[];
      return '给你写了一版：标题「' + String(payload.title ?? '') + '」；卖点：' + points.join('；') + '。详情描述：' + String(payload.description ?? '').slice(0, 80) + '。';
    }
    if (toolName === 'search_knowledge') {
      const chunks = (payload.chunks ?? []) as { title: string; source?: string; content: string }[];
      if (!chunks.length) return '这个我拿不准，建议直接转人工客服帮你确认一下。';
      return '根据《' + chunks[0].title + '》：' + chunks[0].content.slice(0, 90) + '。' + (chunks[1] ? '另外《' + chunks[1].title + '》也有相关规定。' : '');
    }
    if (toolName === 'search_by_isbn') {
      const found = Number(payload.found ?? 0);
      if (!found) return '平台暂时没有这本书（ISBN ' + String(payload.isbn ?? '') + '）。要不要我帮你登记一条求购？到货后通知你。';
      return '扫到了 ' + found + ' 本在售的同款教材，价格和成色都列在下面的卡片里。';
    }
    if (toolName === 'search_by_image') {
      if (payload.needsDescription) return '抱歉，我这边暂时没法直接看图。你用一句话说说图片里是什么（比如「红色包装的辣条」），或者如果是教材，扫书背面的 ISBN 会更快更准。';
      const items = (payload.items ?? []) as { title: string }[];
      return items.length ? '按图片找到 ' + items.length + ' 件相似商品，你看是不是这个？' : '没有找到同款，换个角度拍一张或者告诉我品牌名试试。';
    }
    if (toolName === 'add_to_cart') {
      return '好，已经加进购物车了：' + String(payload.title ?? '商品') + ' × ' + String(payload.quantity ?? 1) + '。还要再配点什么吗？';
    }
    if (toolName === 'apply_after_sale') {
      return '售后申请已经提交，单号 ' + String(payload.afterSaleNo ?? '') + '，管理员审核通过后金额会退回你的余额。';
    }
    return '已经帮你处理好了。';
  }
}

export function formatYuan(cents: number): string {
  return '¥' + (cents / 100).toFixed(2);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_pay: '待付款', paid: '待发货', shipped: '待收货', finished: '已完成',
    cancelled: '已取消', closed: '已关闭',
  };
  return map[status] ?? status;
}

/** 把整段文字切成小块，模拟流式输出的节奏（前台打字机效果一致） */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let index = 0;
  const size = 6;
  while (index < text.length) {
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}