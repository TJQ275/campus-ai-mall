import {
  emptyUsage,
  type ChatMessage,
  type ChatResult,
  type LlmProvider,
  type LlmToolCall,
  type StreamChunk,
  type ToolSpec,
} from './types.js';
import { chunkText, decideToolCall, summarizeToolResult, type RuleMessage } from './mock-rules.js';

/**
 * 无 Key 降级用的本地「假模型」，实现项目自研的 LlmProvider 接口。
 *
 * 迁移到 LangChain 之后，Agent 那条路径已经改用 langchain/mock-chat-model.ts
 * （把同一个规则引擎包成 LangChain 的 BaseChatModel）。
 * 这个类保留下来是因为**还有几个非 Agent 的场景在用自研接口**：
 * 商品文案生成、评论摘要、经营解读 —— 它们是单次文本生成，不需要 Agent 编排，
 * 为它们套一层 LangGraph 只会增加调试成本。
 *
 * ⚠️ 这里**不再持有规则逻辑**：所有判断都委托给 provider/mock-rules.ts。
 * 早期两处各存一份，改一处忘另一处是迟早的事。
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

    const ruleMessages: RuleMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolName: m.name,
    }));

    const last = ruleMessages[ruleMessages.length - 1];

    // 情况一：上一步是工具结果 → 说人话总结，不再调工具
    if (last?.role === 'tool') {
      const text = summarizeToolResult(last.toolName ?? '', last.content);
      for (const piece of chunkText(text)) yield { type: 'text', delta: piece };
      yield { type: 'done', result: { content: text, toolCalls: [], usage: emptyUsage(), model: this.model, degraded: true } };
      return;
    }

    // 情况二：规则意图解析 → 产出一条与真实 Function Calling 同构的 tool_call
    const available = new Set(tools.map((t) => t.name));
    const decided = decideToolCall(ruleMessages, available);
    const toolCalls: LlmToolCall[] = decided
      ? [{
          id: 'mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: decided.name,
          arguments: decided.args,
          rawArguments: JSON.stringify(decided.args),
        }]
      : [];

    yield {
      type: 'done',
      result: { content: '', toolCalls, usage: emptyUsage(), model: this.model, degraded: true },
    };
  }
}
