import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import {
  aiConversations, aiKnowledge, aiMessages, aiPendingActions, aiToolCalls, users,
} from '../../db/schema/index.js';
import { EmbeddingService } from '../ai/embedding.service.js';
import { CopywritingService } from '../ai/copywriting.service.js';
import { LlmService } from '../ai/llm.service.js';

/** 管理端 AI 观测与运营：调用日志、会话回放、知识库、文案生成、经营解读 */
@Injectable()
export class AdminAiService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly embedding: EmbeddingService,
    private readonly copywritingService: CopywritingService,
    private readonly llm: LlmService,
  ) {}

  /** 调用统计：按工具聚合，一眼看出 AI 到底在干什么 */
  async stats(days = 7) {
    // 向量检索的健康状况：失败是静默降级，必须显式暴露出来
    const embeddingHealth = this.embedding.health();
    const since = new Date(Date.now() - days * 86400000);
    const byTool = await this.db.execute(sql`
      select tool_name,
             count(*)::int as calls,
             coalesce(round(avg(duration_ms)), 0)::int as avg_ms,
             sum(case when status = 'error' then 1 else 0 end)::int as errors,
             sum(case when status = 'pending' then 1 else 0 end)::int as pending_count
      from ai_tool_call where created_at >= ${since}
      group by tool_name order by calls desc
    `);
    const totals = await this.db.execute(sql`
      select
        (select count(*)::int from ai_conversation) as conversations,
        (select count(*)::int from ai_message where role = 'user') as user_messages,
        (select count(*)::int from ai_message where degraded = true) as degraded_messages,
        (select count(*)::int from ai_pending_action) as pending_actions,
        (select count(*)::int from ai_pending_action where status = 'confirmed') as confirmed_actions,
        (select count(*)::int from ai_knowledge) as knowledge_count
    `);
    const trend = await this.db.execute(sql`
      select to_char(created_at, 'MM-DD') as day, count(*)::int as calls
      from ai_tool_call where created_at >= now() - interval '14 days'
      group by 1 order by 1
    `);
    const rawTotals = (totals as unknown as { rows: Record<string, number>[] }).rows[0] ?? {};
    const rawByTool = (byTool as unknown as { rows: Record<string, unknown>[] }).rows;
    return {
      totals: {
        conversations: rawTotals.conversations ?? 0,
        userMessages: rawTotals.user_messages ?? 0,
        degradedMessages: rawTotals.degraded_messages ?? 0,
        pendingActions: rawTotals.pending_actions ?? 0,
        confirmedActions: rawTotals.confirmed_actions ?? 0,
        knowledgeCount: rawTotals.knowledge_count ?? 0,
      },
      byTool: rawByTool.map((r) => ({
        toolName: r.tool_name,
        calls: r.calls,
        avgMs: r.avg_ms,
        errors: r.errors,
        pendingCount: r.pending_count,
      })),
      trend: (trend as unknown as { rows: unknown[] }).rows,
      mode: this.llm.status(),
      embeddingEnabled: this.embedding.enabled,
      // 向量检索是否正在「静默降级」—— 配了模型但调用失败时会带上原因和修复建议
      embeddingHealth,
    };
  }

  async toolCalls(params: { toolName?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const conditions = [];
    if (params.toolName) conditions.push(eq(aiToolCalls.toolName, params.toolName));
    if (params.status) conditions.push(eq(aiToolCalls.status, params.status));
    const where = conditions.length ? and(...conditions) : undefined;
    const list = await this.db
      .select({
        id: aiToolCalls.id,
        conversationId: aiToolCalls.conversationId,
        toolName: aiToolCalls.toolName,
        args: aiToolCalls.args,
        result: aiToolCalls.result,
        status: aiToolCalls.status,
        error: aiToolCalls.error,
        durationMs: aiToolCalls.durationMs,
        createdAt: aiToolCalls.createdAt,
        nickname: users.nickname,
      })
      .from(aiToolCalls)
      .leftJoin(users, eq(aiToolCalls.userId, users.id))
      .where(where)
      .orderBy(desc(aiToolCalls.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(aiToolCalls).where(where);
    return { list, total: counted[0]?.total ?? 0, page, pageSize };
  }

  async conversations(params: { scene?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where = params.scene ? eq(aiConversations.scene, params.scene) : undefined;
    const list = await this.db
      .select({
        id: aiConversations.id,
        userId: aiConversations.userId,
        scene: aiConversations.scene,
        title: aiConversations.title,
        messageCount: aiConversations.messageCount,
        lastMessageAt: aiConversations.lastMessageAt,
        createdAt: aiConversations.createdAt,
        nickname: users.nickname,
      })
      .from(aiConversations)
      .leftJoin(users, eq(aiConversations.userId, users.id))
      .where(where)
      .orderBy(desc(aiConversations.lastMessageAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(aiConversations).where(where);
    return { list, total: counted[0]?.total ?? 0, page, pageSize };
  }

  /** 会话回放：消息 + 每一步工具调用，答辩时直接展示「模型做了什么」 */
  async conversationDetail(id: number) {
    const conversation = (await this.db.select().from(aiConversations).where(eq(aiConversations.id, id)).limit(1))[0];
    if (!conversation) throw new NotFoundException('会话不存在');
    const messages = await this.db.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(asc(aiMessages.id));
    const calls = await this.db.select().from(aiToolCalls).where(eq(aiToolCalls.conversationId, id)).orderBy(asc(aiToolCalls.id));
    const actions = await this.db.select().from(aiPendingActions).where(eq(aiPendingActions.conversationId, id)).orderBy(asc(aiPendingActions.id));
    return { conversation, messages, toolCalls: calls, pendingActions: actions };
  }

  copywriting(productId: number, style?: string) {
    return this.copywritingService.generate(productId, style ?? 'student');
  }

  /** 经营解读：把数字翻译成人话，有模型时让模型润色 */
  async insight() {
    const rows = await this.db.execute(sql`
      select
        (select count(*)::int from \"order\") as order_count,
        (select coalesce(sum(pay_cents), 0)::int from \"order\" where pay_status = 'paid') as paid_cents,
        (select count(*)::int from after_sale where status = 'pending') as pending_after_sale,
        (select count(*)::int from \"order\" where source = 'ai') as ai_orders,
        (select coalesce(avg(rating), 0) from review) as avg_rating
    `);
    const kpi = (rows as unknown as { rows: Record<string, number>[] }).rows[0] ?? {};
    const top = await this.db.execute(sql`
      select p.title, sum(oi.quantity)::int as qty from order_item oi
      join product p on p.id = oi.product_id join \"order\" o on o.id = oi.order_id
      where o.pay_status = 'paid' group by p.title order by qty desc limit 3
    `);
    const topList = (top as unknown as { rows: { title: string; qty: number }[] }).rows;

    const facts = [
      '订单总数 ' + (kpi.order_count ?? 0) + ' 笔，已支付金额 ¥' + ((kpi.paid_cents ?? 0) / 100).toFixed(2),
      '待处理售后 ' + (kpi.pending_after_sale ?? 0) + ' 单',
      'AI 助手促成订单 ' + (kpi.ai_orders ?? 0) + ' 笔',
      '平均评分 ' + Number(kpi.avg_rating ?? 0).toFixed(2) + ' 分',
      topList.length ? '热销前三：' + topList.map((t) => t.title + '(' + t.qty + '件)').join('、') : '暂无成交数据',
    ];

    if (this.llm.current.isMock) {
      return {
        title: '经营快报',
        points: facts,
        suggestion:
          (kpi.pending_after_sale ?? 0) > 0
            ? '有 ' + kpi.pending_after_sale + ' 单售后待处理，建议今天先清掉，避免影响评分。'
            : '暂无待处理售后，可以重点推一下热销商品做搭配。',
        model: 'template',
      };
    }

    try {
      const result = await this.llm.current.chat(
        [
          {
            role: 'user',
            content:
              '以下是「AI优选零食」的真实经营数据，请用不超过 120 字给出解读和一条可执行建议，不要编造数字：\n' + facts.join('\n'),
          },
        ],
        [],
      );
      return { title: '经营快报', points: facts, suggestion: result.content.trim(), model: result.model };
    } catch {
      return { title: '经营快报', points: facts, suggestion: '模型暂不可用，以上为原始数据。', model: 'fallback' };
    }
  }

  // ────────── 知识库 ──────────

  async knowledgeList(params: { keyword?: string; scene?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const conditions = [];
    if (params.scene) conditions.push(eq(aiKnowledge.scene, params.scene));
    if (params.keyword) {
      const like = '%' + params.keyword + '%';
      conditions.push(or(ilike(aiKnowledge.title, like), ilike(aiKnowledge.content, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const list = await this.db.select().from(aiKnowledge).where(where).orderBy(asc(aiKnowledge.id)).limit(pageSize).offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(aiKnowledge).where(where);
    return { list, total: counted[0]?.total ?? 0, page, pageSize };
  }

  async knowledgeCreate(input: { scene?: string; title: string; source?: string; content: string }) {
    const created = await this.db
      .insert(aiKnowledge)
      .values({ scene: input.scene ?? 'support', title: input.title, source: input.source ?? null, content: input.content })
      .returning();
    await this.embedKnowledge(created[0].id, input.title, input.content);
    return created[0];
  }

  async knowledgeUpdate(id: number, input: { scene?: string; title?: string; source?: string; content?: string; enabled?: boolean }) {
    // 显式挑字段：早期是 set(input) 全量透传，客户端可以顺手改 embedding 等内部字段
    const patch: Record<string, unknown> = {};
    if (input.scene !== undefined) patch.scene = String(input.scene).slice(0, 20);
    if (input.title !== undefined) patch.title = String(input.title).slice(0, 120);
    if (input.source !== undefined) patch.source = input.source === null ? null : String(input.source).slice(0, 120);
    if (input.content !== undefined) patch.content = String(input.content).slice(0, 10000);
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
    if (!Object.keys(patch).length) throw new BadRequestException('没有需要修改的字段');

    const updated = await this.db.update(aiKnowledge).set(patch).where(eq(aiKnowledge.id, id)).returning();
    if (!updated[0]) throw new NotFoundException('知识条目不存在');
    await this.embedKnowledge(id, updated[0].title, updated[0].content);
    return updated[0];
  }

  async knowledgeRemove(id: number) {
    await this.db.delete(aiKnowledge).where(eq(aiKnowledge.id, id));
    return { removed: true };
  }

  /** 新增或修改后立刻补向量，避免要等到下次批量任务才生效 */
  private async embedKnowledge(id: number, title: string, content: string) {
    if (!this.embedding.enabled) return;
    const vectors = await this.embedding.embed([title + ' | ' + content]);
    if (!vectors) return;
    await this.db.update(aiKnowledge).set({ embedding: vectors[0] }).where(eq(aiKnowledge.id, id));
  }

  async reindex() {
    return this.embedding.backfill(500);
  }
}