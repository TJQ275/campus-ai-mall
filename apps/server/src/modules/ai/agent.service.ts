import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiChatInput, AiEvent } from '@campus/shared';
import { AiService } from './ai.service.js';
import { LlmService } from './llm.service.js';
import { ToolRegistry } from './tools/tool.registry.js';
import { buildSystemPrompt } from './prompt.js';
import type { AiContext } from './tools/tool.types.js';
import type { ChatMessage, ChatResult, LlmProvider, LlmToolCall, ToolSpec } from './provider/types.js';
import type { ProductCard } from '../catalog/catalog.service.js';

const MAX_TOOL_ROUNDS = 4;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly ai: AiService,
    private readonly llm: LlmService,
    private readonly registry: ToolRegistry,
  ) {}

  /**
   * 导购/客服主循环：装配上下文 → 流式调用模型 → 执行工具 → 回灌结果 → 直到模型给出最终回复。
   * 产出的是结构化事件流，控制器直接转成 SSE。
   */
  async *run(userId: number, input: AiChatInput): AsyncGenerator<AiEvent, void, unknown> {
    const started = Date.now();
    const user = await this.ai.loadUser(userId);
    const conversation = await this.ai.ensureConversation(userId, {
      conversationId: input.conversationId,
      scene: input.scene ?? 'shopping',
      pageContext: input.pageContext,
      title: input.message,
    });

    const ctx: AiContext = {
      userId,
      conversationId: conversation.id,
      scene: (input.scene ?? conversation.scene ?? 'shopping') as AiContext['scene'],
      pageContext: input.pageContext ?? (conversation.pageContext as Record<string, unknown> | undefined) ?? undefined,
    };

    await this.ai.appendMessage({
      conversationId: conversation.id,
      userId,
      role: 'user',
      content: input.message,
      attachments: input.imageUrls ?? [],
    });

    const specs = this.registry.specs(ctx.scene);
    const system = buildSystemPrompt(ctx, user, specs.map((s) => s.name));
    const history = await this.ai.history(conversation.id, 16);
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...history.map((m) => this.toChatMessage(m)),
    ];

    const cards: ProductCard[] = [];
    let degraded = this.llm.current.isMock;
    let finalMessageId: number | null = null;
    let lastUsage = { promptTokens: 0, completionTokens: 0, model: this.llm.current.model };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      let provider: LlmProvider = this.llm.current;
      let content = '';
      let result: ChatResult | null = null;
      let emitted = false;
      let attempt = 0;

      while (true) {
        attempt += 1;
        try {
          for await (const chunk of this.streamOnce(provider, messages, specs)) {
            if (chunk.type === 'delta') {
              emitted = true;
              content += chunk.text;
              yield { type: 'text', delta: chunk.text };
            } else {
              result = chunk.result;
            }
          }
          break;
        } catch (error) {
          const message = (error as Error).message ?? String(error);
          this.logger.error('模型调用失败: ' + message);
          // 真实模型在「还没吐出任何内容」时失败 → 自动降级到 Mock，保证演示不中断
          if (attempt === 1 && !emitted && !provider.isMock) {
            provider = this.llm.mock();
            degraded = true;
            content = '';
            yield { type: 'tool_result', toolName: 'llm', ok: false, brief: '真实模型不可用，已切换到本地演示模式' };
            continue;
          }
          yield { type: 'error', message: '模型调用失败：' + message };
          result = { content: '抱歉，我这边暂时联系不上模型服务，请稍后再试。', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 }, model: provider.model, degraded: true };
          break;
        }
      }

      if (!result) break;
      degraded = degraded || result.degraded;
      lastUsage = { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, model: result.model };

      // 没有工具调用 → 这就是最终回复
      if (!result.toolCalls.length) {
        const saved = await this.ai.appendMessage({
          conversationId: conversation.id,
          userId,
          role: 'assistant',
          content: result.content || content,
          cards,
          model: result.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          latencyMs: Date.now() - started,
          degraded,
        });
        finalMessageId = saved.id;
        yield {
          type: 'usage',
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          model: result.model,
          degraded,
          latencyMs: Date.now() - started,
        };
        yield { type: 'done', conversationId: conversation.id, messageId: finalMessageId };
        return;
      }

      // 有工具调用 → 先落库这一步的助手消息（含 tool_calls 原文，便于回放）
      const assistantTurn = await this.ai.appendMessage({
        conversationId: conversation.id,
        userId,
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify(result.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments }))),
        model: result.model,
        latencyMs: Date.now() - started,
        degraded,
      });
      if (result.content) yield { type: 'text', delta: result.content };
      messages.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        yield* this.executeTool(ctx, call, { conversationId: conversation.id, assistantMessageId: assistantTurn.id, cards, messages });
      }
    }

    yield {
      type: 'error',
      message: '这轮对话的工具调用次数已达上限，请换个说法再试一次。',
    };
    yield { type: 'done', conversationId: conversation.id, messageId: finalMessageId };
  }

  /** 单个工具的执行 / 挂起（写操作）分支 */
  private async *executeTool(
    ctx: AiContext,
    call: LlmToolCall,
    io: { conversationId: number; assistantMessageId: number; cards: ProductCard[]; messages: ChatMessage[] },
  ): AsyncGenerator<AiEvent, void, unknown> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      io.messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify({ error: '未知工具 ' + call.name }) });
      return;
    }

    yield { type: 'tool_start', toolName: tool.name, label: tool.label };

    // 写操作：不执行，落 pending 等用户确认
    if (tool.write) {
      const summary = (await tool.confirmSummary?.(call.arguments, ctx)) ?? tool.label;
      const action = await this.ai.createPendingAction({
        conversationId: io.conversationId,
        userId: ctx.userId,
        actionType: tool.name,
        summary,
        payload: call.arguments,
      });
      await this.ai.recordToolCall({
        conversationId: io.conversationId,
        messageId: io.assistantMessageId,
        userId: ctx.userId,
        toolName: tool.name,
        args: call.arguments,
        result: { actionId: action.id, summary },
        status: 'pending',
      });
      yield { type: 'tool_result', toolName: tool.name, ok: true, brief: '等待你确认：' + summary };
      yield { type: 'action_confirm', actionId: action.id, actionType: tool.name, summary };
      io.messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: tool.name,
        content: JSON.stringify({
          status: 'pending_user_confirmation',
          actionId: action.id,
          summary,
          note: '已经交给用户在界面上确认，请在回复里告诉用户点确认按钮即可完成',
        }),
      });
      return;
    }

    const startedAt = Date.now();
    try {
      const outcome = await tool.run(ctx, call.arguments);
      const durationMs = Date.now() - startedAt;
      if (outcome.cards?.length) {
        io.cards.push(...outcome.cards);
        yield { type: 'cards', products: outcome.cards.map((c) => ({ ...c })) };
      }
      yield { type: 'tool_result', toolName: tool.name, ok: true, brief: outcome.brief };
      await this.ai.recordToolCall({
        conversationId: io.conversationId,
        messageId: io.assistantMessageId,
        userId: ctx.userId,
        toolName: tool.name,
        args: call.arguments,
        result: outcome.data,
        status: 'ok',
        durationMs,
      });
      await this.ai.appendMessage({
        conversationId: io.conversationId,
        userId: ctx.userId,
        role: 'tool',
        contentType: 'tool_result',
        content: JSON.stringify(outcome.data),
        toolCallId: call.id,
        toolName: tool.name,
        latencyMs: durationMs,
      });
      const payload =
        outcome.data && typeof outcome.data === 'object' && !Array.isArray(outcome.data)
          ? (outcome.data as Record<string, unknown>)
          : { value: outcome.data };
      io.messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: tool.name,
        content: JSON.stringify({
          ...payload,
          ...(outcome.cards?.length ? { cards: outcome.cards.map((c) => ({ productId: c.id, title: c.title })) } : {}),
        }),
      });
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      await this.ai.recordToolCall({
        conversationId: io.conversationId,
        messageId: io.assistantMessageId,
        userId: ctx.userId,
        toolName: tool.name,
        args: call.arguments,
        status: 'error',
        error: message,
        durationMs: Date.now() - startedAt,
      });
      yield { type: 'tool_result', toolName: tool.name, ok: false, brief: '执行失败：' + message };
      io.messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: JSON.stringify({ error: message }) });
    }
  }

  /** 用户点确认后真正执行写操作 */
  async confirmAction(userId: number, actionId: number, decision: 'confirm' | 'cancel') {
    const action = await this.ai.getPendingAction(userId, actionId);
    if (action.status !== 'pending') return { status: action.status, summary: action.summary, message: '该操作已处理过' };

    const conversation = await this.ai.ensureConversation(userId, { conversationId: action.conversationId });
    const ctx: AiContext = { userId, conversationId: conversation.id, scene: 'shopping' };

    if (decision === 'cancel') {
      await this.ai.updatePendingAction(actionId, { status: 'cancelled', confirmedAt: new Date(), resultMessage: '用户取消了操作' });
      await this.ai.appendMessage({ conversationId: conversation.id, userId, role: 'assistant', content: '好的，已取消：' + action.summary });
      return { status: 'cancelled', summary: action.summary, message: '已取消' };
    }

    const tool = this.registry.get(action.actionType);
    if (!tool) {
      await this.ai.updatePendingAction(actionId, { status: 'failed', resultMessage: '工具不存在' });
      return { status: 'failed', summary: action.summary, message: '工具不存在' };
    }

    const startedAt = Date.now();
    try {
      const outcome = await tool.run(ctx, action.payload as Record<string, unknown>);
      await this.ai.updatePendingAction(actionId, { status: 'confirmed', confirmedAt: new Date(), resultMessage: outcome.brief });
      await this.ai.recordToolCall({
        conversationId: conversation.id,
        userId,
        toolName: tool.name,
        args: action.payload as Record<string, unknown>,
        result: outcome.data,
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });
      await this.ai.appendMessage({
        conversationId: conversation.id,
        userId,
        role: 'assistant',
        content: '已确认执行：' + outcome.brief,
        cards: outcome.cards ?? [],
      });
      return { status: 'confirmed', summary: action.summary, message: outcome.brief, data: outcome.data, cards: outcome.cards ?? [] };
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      await this.ai.updatePendingAction(actionId, { status: 'failed', resultMessage: message });
      return { status: 'failed', summary: action.summary, message };
    }
  }

  /** 把一条模型流包装成事件生成器，便于在上层做「失败重试 / 降级」 */
  private async *streamOnce(
    provider: LlmProvider,
    messages: ChatMessage[],
    specs: ToolSpec[],
  ): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; result: ChatResult }, void, unknown> {
    for await (const chunk of provider.chatStream(messages, specs)) {
      if (chunk.type === 'text') yield { type: 'delta', text: chunk.delta };
      else yield { type: 'done', result: chunk.result };
    }
  }

  private toChatMessage(row: {
    role: string;
    contentType: string;
    content: string | null;
    cards?: unknown[] | null;
    toolName: string | null;
  }): ChatMessage {
    const content = row.content ?? '';
    if (row.role === 'assistant' && row.contentType === 'tool_calls') {
      let calls: { name: string }[] = [];
      try {
        calls = JSON.parse(content) as { name: string }[];
      } catch { calls = []; }
      // 历史里的工具调用轮次不再重放，只留一行痕迹，避免模型重复调用同一工具
      return { role: 'assistant', content: calls.map((c) => '（调用工具 ' + c.name + '）').join(' ') };
    }
    if (row.role === 'tool') {
      return { role: 'assistant', content: '（工具 ' + (row.toolName ?? '') + ' 返回：' + content.slice(0, 1500) + '）' };
    }
    if (row.role === 'assistant') {
      const cards = (row.cards ?? []) as { id?: number; title?: string }[];
      const marker = cards.length
        ? '\n[已展示商品: ' + cards.map((c) => String(c.id) + ':' + String(c.title)).join(' | ') + ']'
        : '';
      return { role: 'assistant', content: content + marker };
    }
    return { role: row.role as ChatMessage['role'], content };
  }
}
