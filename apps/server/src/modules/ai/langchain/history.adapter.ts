import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatMessage } from '../provider/types.js';

/**
 * 把项目内部的消息结构转成 LangChain 的消息类。
 *
 * 为什么只是「转一层」而不重写：
 *   buildHistoryMessages() 负责把落库的消息还原成 assistant(tool_calls) + tool 的**配对结构**，
 *   这件事有 9 条单元测试盯着（历史实现曾把工具结果伪装成助手发言，直接导致模型幻觉）。
 *   换框架不该把这个已经验证过的逻辑推倒重来 —— 所以这里是纯粹的格式转换。
 */
export function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'user') return new HumanMessage(m.content);

    if (m.role === 'tool') {
      return new ToolMessage({
        content: m.content,
        // LangChain 要求 tool 消息必须带 tool_call_id，历史数据里没有就补一个占位
        tool_call_id: m.tool_call_id ?? 'call_hist_unknown',
        name: m.name ?? 'tool',
      });
    }

    // assistant：可能有 tool_calls
    const toolCalls = (m.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      args: c.arguments,
      type: 'tool_call' as const,
    }));
    return new AIMessage({ content: m.content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
  });
}
