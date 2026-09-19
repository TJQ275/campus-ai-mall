import type { ChatMessage } from './provider/types.js';

/** 落库的一条消息（只取重建上下文需要的字段） */
export interface HistoryRow {
  id: number;
  role: string;
  contentType: string;
  content: string | null;
  cards?: unknown[] | null;
  toolName: string | null;
  toolCallId?: string | null;
}

/** 工具结果回灌给模型时的截断长度：历史越长 prompt 越大，这里必须封顶 */
const TOOL_RESULT_LIMIT = 1500;

function toChatMessage(row: HistoryRow): ChatMessage {
  const content = row.content ?? '';
  if (row.role === 'assistant') {
    const cards = (row.cards ?? []) as { id?: number; title?: string }[];
    const marker = cards.length
      ? '\n[已展示商品: ' + cards.map((c) => String(c.id) + ':' + String(c.title)).join(' | ') + ']'
      : '';
    return { role: 'assistant', content: content + marker };
  }
  if (row.role === 'tool') {
    // 兜底：孤立的工具结果（没有配对的 tool_calls 行）标成一条说明，不伪装成助手发言
    return { role: 'user', content: '（历史工具 ' + (row.toolName ?? '') + ' 的结果：' + content.slice(0, 500) + '）' };
  }
  return { role: row.role as ChatMessage['role'], content };
}

/**
 * 把落库的消息还原成模型能理解的对话结构。
 *
 * 早期实现把历史里的 tool 结果改写成「assistant 自己说的一段话」，模型会以为
 * 那些商品数据是自己讲过的（没有工具来源），既违反系统提示里「数字只能来自工具」
 * 的硬规则，也是幻觉的来源。这里保留真实的 assistant(tool_calls) + tool 配对。
 *
 * 配对优先用 tool_call_id 对齐，缺 id 的老数据按顺序配对（工具是串行执行的，顺序可靠）。
 */
export function buildHistoryMessages(rows: HistoryRow[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];

    if (row.role === 'assistant' && row.contentType === 'tool_calls') {
      let calls: { id?: string; name: string; arguments?: unknown }[] = [];
      try {
        const parsed = JSON.parse(row.content ?? '[]') as unknown;
        calls = Array.isArray(parsed) ? (parsed as { name: string }[]) : [];
      } catch {
        calls = [];
      }
      if (!calls.length) {
        // 没有调用明细的空轮次没有信息量，直接丢弃
        i += 1;
        continue;
      }

      const results: HistoryRow[] = [];
      let j = i + 1;
      while (j < rows.length && rows[j].role === 'tool') {
        results.push(rows[j]);
        j += 1;
      }

      const idOfCall = (index: number) => calls[index]?.id || 'call_hist_' + row.id + '_' + index;
      /** 工具结果行的调用 id：有 id 就按 id 认领，老数据没 id 就按顺序配对 */
      const idOfResult = (result: HistoryRow, index: number) => {
        if (result.toolCallId && calls.some((call) => call.id === result.toolCallId)) return result.toolCallId;
        return idOfCall(index);
      };

      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: calls.map((call, index) => ({
          id: idOfCall(index),
          name: call.name,
          arguments: (call.arguments ?? {}) as Record<string, unknown>,
          rawArguments: JSON.stringify(call.arguments ?? {}),
        })),
      });

      // 结果行按自己的 id 配对，而不是按数组下标硬套 ——
      // 两者顺序不一致时（例如上面是 call_x/call_y、结果是 call_y/call_x）下标套法会串位
      results.forEach((result, index) => {
        messages.push({
          role: 'tool',
          tool_call_id: idOfResult(result, index),
          name: result.toolName ?? calls[index]?.name ?? 'tool',
          content: (result.content ?? '').slice(0, TOOL_RESULT_LIMIT),
        });
      });

      i = j;
      continue;
    }

    messages.push(toChatMessage(row));
    i += 1;
  }

  return messages;
}
