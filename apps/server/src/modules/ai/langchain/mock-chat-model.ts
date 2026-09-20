import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  type BaseMessageChunk,
} from '@langchain/core/messages';
// 注意是**值导入**不是 type 导入：LangChain 的分片合并靠实例方法 .concat()，
// 用普通对象伪装成 ChatGenerationChunk 会在流式读取时炸（generationChunk.concat is not a function）。
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { decideToolCall, summarizeToolResult, chunkText, type RuleMessage } from '../provider/mock-rules.js';

/**
 * LangChain 版的「本地兜底模型」。
 *
 * 为什么必须自己写一个 BaseChatModel：
 *   这个项目有一条硬性要求 —— **没有配置大模型 Key 时也必须完整可用**（演示、CI、评测都依赖它）。
 *   而 LangChain 的 ChatOpenAI 没有 Key 就起不来。所以这里把原来的规则引擎包成
 *   LangChain 认得的模型，让上层（createAgent）**完全感知不到差别**。
 *
 * 这也是用框架时最容易被忽略的一件事：**框架不负责你的降级链路，那部分永远得自己写。**
 *
 * 它还顺带成了迁移期的测试基础设施 —— 不用花 API 钱就能验证 Agent 编排是否正确。
 */
export interface MockChatModelFields extends BaseChatModelParams {
  /** createAgent 通过 bindTools 传入的可用工具名 */
  boundToolNames?: string[];
}

export class MockChatModel extends BaseChatModel<MockChatModelFields> {
  static lc_name(): string {
    return 'MockChatModel';
  }

  boundToolNames: string[];

  /** 模型标识，会出现在 usage 事件与后台「当前模式」里 */
  readonly modelName = 'mock-rule-based';

  constructor(fields: MockChatModelFields = {}) {
    super(fields);
    this.boundToolNames = fields.boundToolNames ?? [];
  }

  override _llmType(): string {
    return 'mock-rule-based';
  }

  /**
   * createAgent 会先调 bindTools 把工具绑到模型上。
   * 真实模型是把工具描述发给服务端；我们这里只需要记住工具名，规则引擎靠它判断「能不能调」。
   */
  override bindTools(tools: StructuredToolInterface[]): this {
    const copy = new MockChatModel({
      boundToolNames: tools.map((t) => t.name),
      callbacks: this.callbacks,
    });
    return copy as unknown as this;
  }

  /** LangChain 消息 → 规则引擎认识的简单结构 */
  private toRuleMessages(messages: BaseMessage[]): RuleMessage[] {
    return messages.map((m) => {
      const type = m.getType();
      const content = messageText(m);
      if (type === 'human') return { role: 'user', content } satisfies RuleMessage;
      if (type === 'system') return { role: 'system', content } satisfies RuleMessage;
      if (type === 'tool') {
        const name = (m as unknown as { name?: string }).name;
        return { role: 'tool', content, toolName: name } satisfies RuleMessage;
      }
      return { role: 'assistant', content } satisfies RuleMessage;
    });
  }

  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const ruleMessages = this.toRuleMessages(messages);
    const available = new Set(this.boundToolNames);

    // 上一步是工具结果 → 说人话总结，不再调工具
    const last = ruleMessages[ruleMessages.length - 1];
    if (last?.role === 'tool') {
      const text = summarizeToolResult(last.toolName ?? '', last.content);
      return {
        generations: [{ text, message: new AIMessage({ content: text }) }],
        llmOutput: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: this.modelName },
      };
    }

    const call = decideToolCall(ruleMessages, available);
    const message = call
      ? new AIMessage({
          content: '',
          tool_calls: [{ name: call.name, args: call.args, id: newCallId(), type: 'tool_call' }],
        })
      : new AIMessage({ content: '我在的，你可以直接说想吃什么或者想问什么。' });

    return {
      generations: [{ text: messageText(message), message }],
      llmOutput: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: this.modelName },
    };
  }

  /**
   * 流式：规则引擎本身是「一次性算完」，所以这里把整段文字切成小块吐出去，
   * 让前端的打字机效果和真实模型完全一致。工具调用则一次性给出。
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const result = await this._generate(messages, options, runManager);
    const message = result.generations[0].message;

    for (const piece of chunkText(messageText(message))) {
      yield new ChatGenerationChunk({ text: piece, message: new AIMessageChunk({ content: piece }) });
      await runManager?.handleLLMNewToken(piece);
    }

    // 工具调用不能在分片里切开，最后一次性补一个带 tool_calls 的 chunk
    const toolCalls = (message as AIMessage).tool_calls ?? [];
    if (toolCalls.length) {
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({ content: '', tool_calls: toolCalls }),
      });
    }
  }
}

/** LangChain 的消息 content 可能是字符串，也可能是分片数组，统一取纯文本 */
export function messageText(message: BaseMessage | BaseMessageChunk): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : typeof (part as { text?: string }).text === 'string' ? (part as { text: string }).text : ''))
      .join('');
  }
  return '';
}

function newCallId(): string {
  return 'mock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
