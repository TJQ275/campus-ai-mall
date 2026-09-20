import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AiEvent } from '@campus/shared';
import { STAGE_LABEL } from '../workflow.js';
import { messageText } from './mock-chat-model.js';
import type { RunSink } from './tools.adapter.js';

/**
 * 用 LangChain 的 createAgent（底层是 LangGraph）跑一轮对话，并把它的输出
 * **翻译回我们自己的 SSE 事件协议**。
 *
 * 为什么必须做这层翻译：前端（小程序 + 后台）已经按 text / tool_start / tool_result /
 * cards / action_confirm / stage / usage 这套协议渲染了。换 Agent 框架不该让前端跟着改 ——
 * 所以协议这一层是**我们自己的资产**，框架只负责产生内容。
 *
 * 实测 streamMode: 'messages' 的输出正好对上这三类事件：
 *   ai + tool_calls  → tool_start
 *   tool             → tool_result（附带 cards / action_confirm）
 *   ai + content     → text（逐字）
 */

export interface AgentRunOptions {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  /** 历史消息（已转成 LangChain 消息） */
  history: BaseMessage[];
  userMessage: string;
  sink: RunSink;
  /** 工具名 → 中文标签，用于前端显示「正在检索商品…」 */
  toolLabels: Map<string, string>;
  /** 单轮最大工具轮次 */
  maxToolRounds?: number;
}

/** 运行产物：生成器没法直接 return 复杂值，用这个可变对象带出来 */
export interface AgentRunOutcome {
  text: string;
  rounds: number;
  /** 累计 token 用量。真实模型的 AIMessageChunk 会带 usage_metadata，逐片取最大（它带的是累计值）*/
  usage: { promptTokens: number; completionTokens: number };
}

export async function* runLangChainAgent(
  opts: AgentRunOptions,
  outcome: AgentRunOutcome,
): AsyncGenerator<AiEvent> {
  const agent = createAgent({
    model: opts.model,
    tools: opts.tools,
    systemPrompt: opts.systemPrompt,
  });

  const stream = await agent.stream(
    { messages: [...opts.history, new HumanMessage(opts.userMessage)] },
    {
      streamMode: 'messages',
      // LangGraph 默认 25 步；这里按工具轮次换算（每轮 = 1 次模型 + 1 次工具）
      recursionLimit: ((opts.maxToolRounds ?? 6) + 2) * 2,
    },
  );

  const startedToolCalls = new Set<string>();
  let resultCursor = 0;
  let cardCursor = 0;
  let actionCursor = 0;
  let actStageEmitted = false;
  let text = '';
  let rounds = 0;
  const usage = { promptTokens: 0, completionTokens: 0 };

  for await (const chunk of stream) {
    // streamMode: 'messages' 产出 [message, metadata] 二元组
    const message = (Array.isArray(chunk) ? chunk[0] : chunk) as BaseMessage & {
      tool_calls?: { id?: string; name: string }[];
      name?: string;
    };
    if (!message || typeof message.getType !== 'function') continue;

    const type = message.getType();

    if (type === 'ai') {
      // 记账：LangChain 的分片带的是**累计** usage_metadata，所以取最大值而不是相加，
      // 否则同一轮会被重复计好几次，账单会虚高。
      const meta = (message as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
      if (meta) {
        if (typeof meta.input_tokens === 'number') usage.promptTokens = Math.max(usage.promptTokens, meta.input_tokens);
        if (typeof meta.output_tokens === 'number') usage.completionTokens = Math.max(usage.completionTokens, meta.output_tokens);
      }

      // ① 模型决定调用工具 → tool_start
      for (const call of message.tool_calls ?? []) {
        const key = call.id ?? call.name;
        if (startedToolCalls.has(key)) continue;
        startedToolCalls.add(key);
        if (!actStageEmitted) {
          actStageEmitted = true;
          yield { type: 'stage', stage: 'act', label: STAGE_LABEL.act, status: 'start' };
        }
        yield {
          type: 'tool_start',
          toolName: call.name,
          label: opts.toolLabels.get(call.name) ?? call.name,
        };
      }

      // ③ 模型的自然语言输出 → text（逐字）
      const piece = messageText(message);
      if (piece) {
        text += piece;
        yield { type: 'text', delta: piece };
      }
      continue;
    }

    if (type === 'tool') {
      // ② 工具执行完 → tool_result（摘要从 sink 按顺序取，LangChain 的 ToolMessage 不带中文摘要）
      rounds += 1;
      const toolName = message.name ?? 'tool';
      const recorded = opts.sink.toolResults[resultCursor];
      resultCursor += 1;
      yield {
        type: 'tool_result',
        toolName,
        ok: recorded?.ok ?? true,
        brief: recorded?.brief ?? '',
      };

      // 工具产生的商品卡片
      if (cardCursor < opts.sink.cards.length) {
        const fresh = opts.sink.cards.slice(cardCursor);
        cardCursor = opts.sink.cards.length;
        yield { type: 'cards', products: fresh.map((c) => ({ ...c })) };
      }

      // 写操作产生的待确认动作
      while (actionCursor < opts.sink.pendingActions.length) {
        const action = opts.sink.pendingActions[actionCursor];
        actionCursor += 1;
        yield {
          type: 'action_confirm',
          actionId: action.actionId,
          actionType: action.actionType,
          summary: action.summary,
        };
      }
    }
  }

  outcome.text = text;
  outcome.rounds = rounds;
  outcome.usage = usage;
}
