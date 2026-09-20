import { Injectable, Logger } from '@nestjs/common';
import type { AiChatInput, AiEvent } from '@campus/shared';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { AiService } from './ai.service.js';
import { LlmService } from './llm.service.js';
import { AiUsageService } from './usage.service.js';
import { ToolRegistry } from './tools/tool.registry.js';
import { buildSystemPrompt } from './prompt.js';
import { buildHistoryMessages } from './history.js';
import type { AiContext } from './tools/tool.types.js';
import { MockChatModel } from './langchain/mock-chat-model.js';
import { createRunSink, toLangChainTool, type WriteInterceptor } from './langchain/tools.adapter.js';
import { runLangChainAgent, type AgentRunOutcome } from './langchain/agent-runner.js';
import { toLangChainMessages } from './langchain/history.adapter.js';
import {
  STAGE_LABEL,
  verifyAnswer,
  hasBlockingIssue,
  buildCorrectionPrompt,
  type VerifyIssue,
} from './workflow.js';

/**
 * 单轮最多几轮工具调用。
 *
 * LangChain 的 createAgent 用 recursionLimit 表达「图最多走多少步」——
 * 每轮工具 = 1 次模型节点 + 1 次工具节点，所以这里换算成 (轮次 + 2) * 2 再传进去。
 */
const MAX_TOOL_ROUNDS = 6;

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
   * 导购 / 客服主流程。
   *
   * 现在的实现是 **LangChain createAgent（底层 LangGraph）+ 我们自己的事件协议**：
   *   - 模型走 LangChain（ChatOpenAI 或自定义的 MockChatModel）
   *   - 工具走 LangChain 的 tool()（由 tools.adapter 从项目里的 AiTool 转换而来）
   *   - 编排交给 createAgent，不再自己写 while 循环
   *   - **产出仍然是项目原有的 SSE 事件协议**（text / tool_start / tool_result / cards /
   *     action_confirm / stage / usage / done），前端一行都不用改
   *
   * 框架替不了、因此仍然自己实现的部分：
   *   两阶段写操作（tools.adapter 里拦截）、按调用粒度记账、作答前规则校验、预算闸门。
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

    let degraded = this.llm.isMockMode;

    // 日预算闸门：超预算就整轮用本地模型，不再产生任何费用
    const budget = await this.usage.budgetStatus();
    const overBudget = budget.overBudget && !this.llm.isMockMode;
    if (overBudget) {
      degraded = true;
      this.logger.warn('今日 AI 预算已用完（已花 ' + budget.spentMicro + ' 微元 / 预算 ' + budget.budgetMicro + '），本轮降级为本地模式');
    }

    const sceneTools = this.registry.toolsForScene(ctx.scene);
    yield { type: 'stage', stage: 'understand', label: STAGE_LABEL.understand, status: 'done', brief: ctx.scene + ' 场景' };
    yield {
      type: 'stage', stage: 'plan', label: STAGE_LABEL.plan, status: 'done',
      brief: '可用工具 ' + sceneTools.length + ' 个' + (overBudget ? '（预算已用尽，走本地模式）' : ''),
    };

    const system = buildSystemPrompt(ctx, user, sceneTools.map((t) => t.name));
    const history = await this.ai.history(conversation.id, 16);
    const historyMessages = toLangChainMessages(buildHistoryMessages(history));

    const sink = createRunSink();
    const toolLabels = new Map(sceneTools.map((t) => [t.name, t.label]));
    const model = overBudget ? new MockChatModel() : this.llm.chatModel({ streaming: true });
    const tools = sceneTools.map((t) => toLangChainTool(t, ctx, sink, this.writeInterceptor()));

    const outcome: AgentRunOutcome = { text: '', rounds: 0, usage: { promptTokens: 0, completionTokens: 0 } };
    try {
      yield* runLangChainAgent(
        {
          model, tools, systemPrompt: system, history: historyMessages,
          userMessage: input.message, sink, toolLabels, maxToolRounds: MAX_TOOL_ROUNDS, signal,
        },
        outcome,
      );
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      this.logger.error('Agent 执行失败: ' + message);
      degraded = true;
      outcome.text = outcome.text || '抱歉，我这边暂时联系不上模型服务，请稍后再试。';
      yield { type: 'error', message: '模型调用失败：' + message };
    }

    // ── 校验阶段：把草稿过一遍规则，命中阻断就带着纠正指令重写 ──
    yield { type: 'stage', stage: 'verify', label: STAGE_LABEL.verify, status: 'start' };
    const verified = await this.verifyAndCorrect({
      userId,
      conversationId: conversation.id,
      scene: ctx.scene,
      userMessage: input.message,
      draft: outcome.text,
      trace: sink,
      overBudget,
      // 重写同样是模型调用：直接问一次，不带工具，避免它又去调工具
      regenerate: async (correctionPrompt) => {
        const retry = await model.invoke([
          ...historyMessages,
          new HumanMessage(input.message),
          new AIMessage(outcome.text),
          new HumanMessage(correctionPrompt),
        ]);
        const text = typeof retry.content === 'string' ? retry.content : '';
        await this.usage.record({
          userId, conversationId: conversation.id, scene: ctx.scene,
          model: this.llm.current.model, kind: 'chat', degraded,
        });
        return text;
      },
    });

    const blocking = verified.issues.filter((x) => x.severity === 'block');
    const warning = verified.issues.filter((x) => x.severity === 'warn');
    if (warning.length) this.logger.warn('回答校验告警: ' + warning.map((x) => x.rule + ' ' + x.detail).join(' | '));
    yield {
      type: 'stage', stage: 'verify', label: STAGE_LABEL.verify, status: 'done',
      brief: blocking.length
        ? '发现 ' + blocking.length + ' 个问题' + (verified.corrected ? '，已修正' : '')
        : '通过' + (warning.length ? '（' + warning.length + ' 条告警）' : ''),
    };

    // ── 记账：一次模型调用一条，和迁移前保持一致 ──
    await this.usage.record({
      userId,
      conversationId: conversation.id,
      scene: ctx.scene,
      model: this.llm.current.model,
      kind: 'chat',
      promptTokens: outcome.usage.promptTokens,
      completionTokens: outcome.usage.completionTokens,
      latencyMs: Date.now() - started,
      degraded,
    });

    yield { type: 'stage', stage: 'respond', label: STAGE_LABEL.respond, status: 'start' };
    const saved = await this.ai.appendMessage({
      conversationId: conversation.id,
      userId,
      role: 'assistant',
      content: verified.text,
      cards: sink.cards,
      model: this.llm.current.model,
      promptTokens: outcome.usage.promptTokens,
      completionTokens: outcome.usage.completionTokens,
      latencyMs: Date.now() - started,
      degraded,
    });

    yield {
      type: 'usage',
      promptTokens: outcome.usage.promptTokens,
      completionTokens: outcome.usage.completionTokens,
      model: this.llm.current.model,
      degraded,
      latencyMs: Date.now() - started,
    };
    yield { type: 'done', conversationId: conversation.id, messageId: saved.id };
  }

  /**
   * 写操作拦截器：LangChain 不管「AI 能不能直接改数据」，这部分必须我们自己保留。
   * 加购 / 售后这类工具不会真的执行，而是先落一条待确认记录，等用户在界面上点确认。
   */
  private writeInterceptor(): WriteInterceptor {
    return {
      createPendingAction: (input) =>
        this.ai.createPendingAction({
          conversationId: input.conversationId,
          userId: input.userId,
          actionType: input.actionType,
          summary: input.summary,
          payload: input.payload,
        }),
      // 刻意 await 后不返回：审计记录的返回值对调用方没用，
      // 直接 return 会把 Promise<记录> 当成 Promise<void> 造成类型不匹配。
      recordToolCall: async (input) => {
        await this.ai.recordToolCall({
          conversationId: input.conversationId,
          userId: input.userId,
          toolName: input.toolName,
          args: input.args,
          result: input.result,
          status: input.status as 'ok' | 'error' | 'pending' | 'denied',
          durationMs: input.durationMs,
          error: input.error,
        });
      },
    };
  }

  private async verifyAndCorrect(args: {
    userId: number;
    conversationId: number;
    scene: string;
    userMessage: string;
    draft: string;
    trace: { toolsCalled: string[]; writeToolsCalled: string[]; toolContextParts: string[]; pendingActionCount: number };
    overBudget: boolean;
    regenerate: (correctionPrompt: string) => Promise<string>;
  }): Promise<{ text: string; issues: VerifyIssue[]; corrected: boolean }> {
    const check = (answer: string) =>
      verifyAnswer({
        userMessage: args.userMessage,
        answer,
        scene: args.scene,
        toolsCalled: args.trace.toolsCalled,
        writeToolsCalled: args.trace.writeToolsCalled,
        pendingActionCount: args.trace.pendingActionCount,
        toolContext: args.trace.toolContextParts.join('\n'),
      });

    const issues = check(args.draft);
    if (!hasBlockingIssue(issues)) return { text: args.draft, issues, corrected: false };

    const blocking = issues.filter((i) => i.severity === 'block');
    this.logger.warn('回答未通过校验，触发重写: ' + blocking.map((i) => i.rule).join(', '));

    try {
      const rewritten = (await args.regenerate(buildCorrectionPrompt(blocking))).trim();
      if (rewritten) {
        const recheck = check(rewritten);
        if (!hasBlockingIssue(recheck)) {
          return { text: rewritten, issues: [...issues, ...recheck], corrected: true };
        }
        this.logger.warn('重写后仍有阻断问题: ' + recheck.filter((i) => i.severity === 'block').map((i) => i.rule).join(', '));
      }
    } catch (error) {
      this.logger.warn('重写失败: ' + (error as Error).message);
    }

    // 兜底：不把假的成功确认发给用户
    this.logger.error('校验未通过且重写无效，返回兜底说明: ' + blocking.map((i) => i.rule).join(', '));
    return {
      text: '这件事我这边还没能完成，麻烦你再说一次，或者在界面上点一下确认按钮。',
      issues,
      corrected: true,
    };
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
}
