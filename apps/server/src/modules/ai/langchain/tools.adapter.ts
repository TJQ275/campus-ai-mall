import { tool as lcTool, type StructuredToolInterface } from '@langchain/core/tools';
import type { AiContext, AiTool, ToolResult } from '../tools/tool.types.js';
import type { ProductCard } from '../../catalog/catalog.service.js';

/**
 * 本次运行的「观测箱」。
 *
 * 为什么需要它：工具执行发生在 LangGraph 的节点里，而我们的 SSE 事件要从外层的
 * 异步生成器里 yield 出去 —— 两个世界之间需要一块共享内存传递副作用
 * （商品卡片、待确认动作、成本校验要用的工具结果原文）。
 */
export interface RunSink {
  toolsCalled: string[];
  writeToolsCalled: string[];
  toolContextParts: string[];
  pendingActionCount: number;
  /** 顺序收集卡片，供 SSE 的 cards 事件使用 */
  cards: ProductCard[];
  /** 顺序收集待确认动作，供 SSE 的 action_confirm 事件使用 */
  pendingActions: { actionId: number; actionType: string; summary: string }[];
  /**
   * 顺序收集「给用户看的一句话摘要」。
   * LangChain 的 ToolMessage 只带工具返回的原始内容，不带我们想要的简短中文摘要，
   * 所以在这里按执行顺序存一份，运行器按同样顺序取用。
   */
  toolResults: { name: string; ok: boolean; brief: string }[];
}

export function createRunSink(): RunSink {
  return {
    toolsCalled: [],
    writeToolsCalled: [],
    toolContextParts: [],
    pendingActionCount: 0,
    cards: [],
    pendingActions: [],
    toolResults: [],
  };
}

/** 写操作落库的回调，由 AgentService 注入（它才有 AiService） */
export interface WriteInterceptor {
  createPendingAction(input: {
    conversationId: number;
    userId: number;
    actionType: string;
    summary: string;
    payload: Record<string, unknown>;
  }): Promise<{ id: number }>;
  recordToolCall(input: {
    conversationId: number;
    userId: number;
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    status: string;
    durationMs?: number;
    error?: string;
  }): Promise<void>;
}

/**
 * 把项目里的 AiTool 转成 LangChain 的 tool()。
 *
 * 关键点：**写操作的拦截逻辑必须留在这里，而不是交给工具自己**。
 * LangChain 不管「AI 能不能直接改数据」这件事 —— 两阶段确认是我们自己的安全设计，
 * 换任何框架都得自己保留。这也是「框架替不了你最关键那部分」的具体例子。
 */
export function toLangChainTool(
  aiTool: AiTool,
  ctx: AiContext,
  sink: RunSink,
  interceptor: WriteInterceptor,
): StructuredToolInterface {
  const run = async (args: Record<string, unknown>): Promise<string> => {
    const startedAt = Date.now();
    sink.toolsCalled.push(aiTool.name);
    if (aiTool.write) sink.writeToolsCalled.push(aiTool.name);

    // ── 写操作：不执行，先落 pending 等用户确认 ──
    if (aiTool.write) {
      const summary = (await aiTool.confirmSummary?.(args, ctx)) ?? aiTool.label;
      const action = await interceptor.createPendingAction({
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        actionType: aiTool.name,
        summary,
        payload: args,
      });
      sink.pendingActionCount += 1;
      sink.pendingActions.push({ actionId: action.id, actionType: aiTool.name, summary });
      sink.toolResults.push({ name: aiTool.name, ok: true, brief: '等待你确认：' + summary });
      sink.toolContextParts.push(aiTool.name + ' ' + summary);

      await interceptor.recordToolCall({
        conversationId: ctx.conversationId, userId: ctx.userId, toolName: aiTool.name,
        args, result: { actionId: action.id, summary }, status: 'pending',
      });

      // 回给模型的内容要和原来一致，否则模型会以为已经执行完了
      return JSON.stringify({
        status: 'pending_user_confirmation',
        actionId: action.id,
        summary,
        note: '已经交给用户在界面上确认，请在回复里告诉用户点确认按钮即可完成',
      });
    }

    // ── 只读操作：正常执行 ──
    try {
      const outcome: ToolResult = await aiTool.run(ctx, args);
      const durationMs = Date.now() - startedAt;
      if (outcome.cards?.length) sink.cards.push(...outcome.cards);
      sink.toolResults.push({ name: aiTool.name, ok: true, brief: outcome.brief ?? '' });
      sink.toolContextParts.push(aiTool.name + ' ' + (outcome.brief ?? '') + ' ' + JSON.stringify(outcome.data ?? {}));

      await interceptor.recordToolCall({
        conversationId: ctx.conversationId, userId: ctx.userId, toolName: aiTool.name,
        args, result: outcome.data, status: 'ok', durationMs,
      });

      const payload =
        outcome.data && typeof outcome.data === 'object' && !Array.isArray(outcome.data)
          ? (outcome.data as Record<string, unknown>)
          : { value: outcome.data };
      return JSON.stringify({
        ...payload,
        ...(outcome.cards?.length ? { cards: outcome.cards.map((c) => ({ productId: c.id, title: c.title })) } : {}),
      });
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      sink.toolResults.push({ name: aiTool.name, ok: false, brief: '执行失败：' + message });
      await interceptor.recordToolCall({
        conversationId: ctx.conversationId, userId: ctx.userId, toolName: aiTool.name,
        args, result: null, status: 'error', error: message, durationMs: Date.now() - startedAt,
      });
      return JSON.stringify({ error: message });
    }
  };

  return lcTool(run, {
    name: aiTool.name,
    description: aiTool.description,
    // 项目里的 schema 声明为 ZodType，这里收窄成 LangChain 需要的对象形状
    schema: aiTool.schema as never,
  }) as unknown as StructuredToolInterface;
}
