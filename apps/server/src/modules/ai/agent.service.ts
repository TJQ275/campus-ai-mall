import { Injectable, Logger } from '@nestjs/common';
import type { AiChatInput, AiEvent } from '@campus/shared';
import { AiService } from './ai.service.js';
import { LlmService } from './llm.service.js';
import { AiUsageService } from './usage.service.js';
import { ToolRegistry } from './tools/tool.registry.js';
import { buildSystemPrompt } from './prompt.js';
import { buildHistoryMessages } from './history.js';
import type { AiContext } from './tools/tool.types.js';
import type { ChatMessage, ChatResult, LlmProvider, LlmToolCall, ToolSpec } from './provider/types.js';
import type { ProductCard } from '../catalog/catalog.service.js';

// 实测 4 轮不够：模型遇到「把X加到购物车」会先查画像 → 再检索两次 → 再看详情，
// 4 轮被检索吃光，真正的 add_to_cart 根本没机会调用，收尾时还会谎称已完成。
// 配合「相同参数去重」，放宽到 6 轮既够用又不会被无限检索拖住。
const MAX_TOOL_ROUNDS = 6;

/**
 * 轮次用尽后的收尾提示。
 *
 * 最后那句诚实性要求是必须的：实测模型在没有工具可用时，会直接宣称
 * 「已把商品加入购物车」——而它根本没调用 add_to_cart，用户会以为购物车里真有东西。
 * 宁可让模型说「这件事还没完成」，也不能给一个假的成功确认。
 */
const FORCED_ANSWER_HINT = [
  '（系统提醒）已经达到工具调用次数上限，本轮不能再调用任何工具。',
  '请基于上面已经拿到的工具结果，用中文回答用户最初的问题。',
  '重要的诚实性要求：如果用户要求的是一个「操作」（加购、下单、申请售后等），',
  '而上面的对话里并没有该操作的工具执行结果，你必须如实说明「这件事还没完成」，',
  '并告诉用户再说一次或点确认即可；绝对不许声称已经完成。',
].join('');

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly ai: AiService,
    private readonly llm: LlmService,
    private readonly registry: ToolRegistry,
    private readonly usage: AiUsageService,
  ) {}

  /**
   * 导购/客服主循环：装配上下文 → 流式调用模型 → 执行工具 → 回灌结果 → 直到模型给出最终回复。
   * 产出的是结构化事件流，控制器直接转成 SSE。
   *
   * options.signal：客户端断开时中止。SSE 场景必须传 —— 用户切走页面后
   * 后续的模型调用和工具轮次都不应该继续消耗 token。
   */
  async *run(userId: number, input: AiChatInput, options: { signal?: AbortSignal } = {}): AsyncGenerator<AiEvent, void, unknown> {
    const signal = options.signal;
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
      ...buildHistoryMessages(history),
    ];

    const cards: ProductCard[] = [];
    // 同一轮对话里「工具名 + 参数」的指纹集合。
    // 实测轻量模型会拿一模一样的参数反复调 search_products，
    // 4 轮上限被烧光，用户拿到的是「工具调用次数已达上限」而不是答案。
    // 重复调用直接不执行，改成回灌一条提示让模型基于已有结果作答。
    const calledFingerprints = new Set<string>();
    let degraded = this.llm.current.isMock;
    let finalMessageId: number | null = null;

    // 日预算闸门：今天花的钱超过预算就整轮降级到本地 Mock，避免账单失控。
    // 用户拿到的回复依旧完整可用（规则 + 协同过滤），只是不再调用收费模型。
    const budget = await this.usage.budgetStatus();
    const overBudget = budget.overBudget && !this.llm.current.isMock;
    if (overBudget) {
      degraded = true;
      this.logger.warn('今日 AI 预算已用完（已花 ' + budget.spentMicro + ' 微元 / 预算 ' + budget.budgetMicro + '），本轮降级为本地模式');
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      // 客户端已经断开：立刻停止，不再发起新的模型调用
      if (signal?.aborted) {
        this.logger.log('客户端已断开，停止本轮对话（已进行 ' + round + ' 轮工具调用）');
        return;
      }
      // 超预算时整轮都用 Mock，不再发起任何收费调用
      let provider: LlmProvider = overBudget ? this.llm.mock() : this.llm.current;
      let content = '';
      let result: ChatResult | null = null;
      let emitted = false;
      let attempt = 0;

      while (true) {
        attempt += 1;
        try {
          for await (const chunk of this.streamOnce(provider, messages, specs, signal)) {
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

      // 每一轮模型调用都记一笔账，**包含中间的工具轮次**。
      // 修掉的 bug：原先只在「最终回复」那条 ai_message 上落 token，
      // 一次 3 轮工具的对话实际付了 3 次调用的钱，账上却只记了最后 1 次。
      await this.usage.record({
        userId,
        conversationId: conversation.id,
        scene: ctx.scene,
        model: result.model,
        kind: 'chat',
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latencyMs: Date.now() - started,
        // 用「这一次调用」的降级状态，而不是累积值，否则一次降级会把后面所有调用都标成降级
        degraded: result.degraded,
      });

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
      // 带上 id 是为了下次重建上下文时能还原成真正的 assistant(tool_calls) + tool 结构
      const assistantTurn = await this.ai.appendMessage({
        conversationId: conversation.id,
        userId,
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify(result.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }))),
        model: result.model,
        latencyMs: Date.now() - started,
        degraded,
      });
      // 这里**不能**再 yield result.content：provider 在流式读循环里已经把每个 delta
      // 通过 { type: 'text' } 发过了，result.content 是它们的拼接。再发一次等于把这句话重播一遍
      // （评测跑出来的现象是同一句话连着出现两遍）。
      messages.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        const fingerprint = call.name + ':' + JSON.stringify(call.arguments ?? {});
        if (calledFingerprints.has(fingerprint)) {
          // 不执行，回灌一条提示让模型基于已有结果作答
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({
              note: '你已经用完全相同的参数调用过这个工具，结果就在上面的对话里。请直接据此回答用户，不要再次调用。',
              repeated: true,
            }),
          });
          yield { type: 'tool_result', toolName: call.name, ok: true, brief: '参数与上次相同，已跳过重复调用' };
          continue;
        }
        calledFingerprints.add(fingerprint);
        yield* this.executeTool(ctx, call, { conversationId: conversation.id, assistantMessageId: assistantTurn.id, cards, messages });
      }
    }

    // 轮次用尽。原实现是直接甩一句「工具调用次数已达上限」就结束 ——
    // 评测里「推荐个方便面」正是走到这里，用户拿到的是**空回复**，非常糟糕。
    // 正确做法是：把工具摘掉再问一次，逼模型用已经拿到的结果作答。
    const lastProvider = overBudget ? this.llm.mock() : this.llm.current;
    let forcedText = '';
    try {
      const forced = await lastProvider.chat(
        [...messages, { role: 'user', content: FORCED_ANSWER_HINT }],
        [],
        signal,
      );
      forcedText = (forced.content ?? '').trim();
      await this.usage.record({
        userId, conversationId: conversation.id, scene: ctx.scene,
        model: forced.model, kind: 'chat',
        promptTokens: forced.usage.promptTokens, completionTokens: forced.usage.completionTokens,
        latencyMs: Date.now() - started, degraded: forced.degraded,
      });
    } catch (error) {
      this.logger.warn('收尾作答失败: ' + (error as Error).message);
    }

    if (forcedText) {
      const saved = await this.ai.appendMessage({
        conversationId: conversation.id, userId, role: 'assistant',
        content: forcedText, cards, model: lastProvider.model,
        latencyMs: Date.now() - started, degraded,
      });
      yield { type: 'text', delta: forcedText };
      yield { type: 'done', conversationId: conversation.id, messageId: saved.id };
      return;
    }

    yield { type: 'error', message: '这轮对话太复杂了，请换个说法再试一次。' };
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

  /**
   * 用户点确认后真正执行写操作。
   *
   * 并发安全：先原子抢占（把 status 从 pending 改成 executing），只有抢到的那次调用会执行工具。
   * 之前是「先读到 pending 再执行」，用户双击确认按钮会加两次购物车 / 提交两张售后单。
   */
  async confirmAction(userId: number, actionId: number, decision: 'confirm' | 'cancel') {
    const action = await this.ai.getPendingAction(userId, actionId);

    if (action.status !== 'pending') {
      const label: Record<string, string> = {
        confirmed: '该操作已经执行过了',
        cancelled: '该操作已经取消过了',
        executing: '该操作正在执行中，请稍候',
        failed: '该操作执行失败过，请重新发起',
        expired: '该操作已过期，请重新发起',
      };
      return { status: action.status, summary: action.summary, message: label[action.status] ?? '该操作已处理过' };
    }

    // 过期校验：待确认操作只有 10 分钟有效期（ai_pending_action.expires_at）
    if (action.expiresAt && action.expiresAt.getTime() < Date.now()) {
      await this.ai.updatePendingAction(actionId, { status: 'expired', resultMessage: '超过有效期，已自动作废' });
      return { status: 'expired', summary: action.summary, message: '这个操作已经超过 10 分钟有效期了，请重新告诉我要做什么' };
    }

    const conversation = await this.ai.ensureConversation(userId, { conversationId: action.conversationId });
    const ctx: AiContext = { userId, conversationId: conversation.id, scene: 'shopping' };

    // 抢占：拿不到就说明另一个请求已经在处理（或刚刚处理完）
    const claimed = await this.ai.claimPendingAction(userId, actionId);
    if (!claimed) {
      return { status: 'duplicate', summary: action.summary, message: '这个操作正在处理或已经完成，请勿重复点击' };
    }

    if (decision === 'cancel') {
      await this.ai.updatePendingAction(actionId, { status: 'cancelled', resultMessage: '用户取消了操作' });
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
      await this.ai.updatePendingAction(actionId, { status: 'confirmed', resultMessage: outcome.brief });
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
      // 失败就置为 failed，不做「放回 pending 让用户重试」——
      // 写操作可能已经落库一半，让用户重试有重复写入的风险，宁可让他重新发起一次
      await this.ai.updatePendingAction(actionId, { status: 'failed', resultMessage: message });
      return { status: 'failed', summary: action.summary, message };
    }
  }

  /** 把一条模型流包装成事件生成器，便于在上层做「失败重试 / 降级」 */
  private async *streamOnce(
    provider: LlmProvider,
    messages: ChatMessage[],
    specs: ToolSpec[],
    signal?: AbortSignal,
  ): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; result: ChatResult }, void, unknown> {
    for await (const chunk of provider.chatStream(messages, specs, signal)) {
      if (chunk.type === 'text') yield { type: 'delta', text: chunk.delta };
      else yield { type: 'done', result: chunk.result };
    }
  }
}
