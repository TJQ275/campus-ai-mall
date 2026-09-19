import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { aiUsage, sysConfigs } from '../../db/schema/index.js';
import { estimateCostMicro, formatCost, PRICE_TABLE_VERSION } from './pricing.js';

/** 日预算存放在 sys_config 里的键名，和管理后台「AI 设置」共用一套配置机制 */
export const DAILY_BUDGET_KEY = 'ai.daily_budget_micro';

export interface UsageInput {
  userId?: number | null;
  conversationId?: number | null;
  scene?: string | null;
  model: string;
  /** chat 对话 | embedding 向量 | vision 识图 | test 连通性测试 */
  kind?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  degraded?: boolean;
}

/** 预算检查结果的缓存时长：每轮对话都查一次库没必要，但也不能缓存太久导致超支不拦 */
const BUDGET_CACHE_MS = 30_000;

/**
 * 用量与费用。对外只有两件事：
 *   1. record()  —— 每次模型调用后记一笔（顺带算钱）
 *   2. 各类聚合  —— 给管理后台「AI 成本」页面用
 *
 * 记账本身**不允许失败影响主流程**：写不进去只打日志，绝不让用户因为记账问题收不到回复。
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  private budgetCache: { at: number; budgetMicro: number; spentMicro: number } | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  /** 记一笔用量。降级（MockProvider）的调用价格为 0，但仍记录，方便看降级比例 */
  async record(input: UsageInput): Promise<void> {
    const promptTokens = Math.max(0, Math.trunc(input.promptTokens ?? 0) || 0);
    const completionTokens = Math.max(0, Math.trunc(input.completionTokens ?? 0) || 0);
    const degraded = Boolean(input.degraded);
    const { costMicro } = estimateCostMicro(input.model, promptTokens, completionTokens);

    // 降级调用不产生真实费用。不过如果是真实模型报错后降级，token 本来就该记 0；
    // 这里再兜一层，避免「模型没调成功却记了一笔钱」。
    const finalCost = degraded ? 0 : costMicro;

    try {
      await this.db.insert(aiUsage).values({
        userId: input.userId ?? null,
        conversationId: input.conversationId ?? null,
        scene: input.scene ?? null,
        model: input.model,
        kind: input.kind ?? 'chat',
        promptTokens,
        completionTokens,
        costMicro: finalCost,
        latencyMs: Math.max(0, Math.trunc(input.latencyMs ?? 0) || 0),
        degraded,
        priceVersion: PRICE_TABLE_VERSION,
      });
    } catch (error) {
      // 记账失败不能影响用户拿到回复
      this.logger.warn('用量记账失败（不影响主流程）: ' + (error as Error).message);
    }
  }

  // ==================== 预算 ====================

  /** 读取日预算（0 或未设置 = 不限额） */
  async getDailyBudgetMicro(): Promise<number> {
    try {
      const rows = await this.db.select().from(sysConfigs).where(eq(sysConfigs.key, DAILY_BUDGET_KEY));
      const raw = Number(rows[0]?.value ?? 0);
      return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
    } catch {
      return 0;
    }
  }

  async setDailyBudgetMicro(value: number): Promise<void> {
    const next = Math.max(0, Math.trunc(Number(value) || 0));
    const existing = await this.db.select().from(sysConfigs).where(eq(sysConfigs.key, DAILY_BUDGET_KEY));
    if (existing.length) {
      await this.db.update(sysConfigs).set({ value: String(next) }).where(eq(sysConfigs.key, DAILY_BUDGET_KEY));
    } else {
      await this.db.insert(sysConfigs).values({ key: DAILY_BUDGET_KEY, value: String(next) });
    }
    this.budgetCache = null;
  }

  /** 今天的已花费（微元） */
  async spentTodayMicro(): Promise<number> {
    const rows = await this.db.execute(sql`
      select coalesce(sum(cost_micro), 0)::bigint as spent
      from ai_usage
      where created_at >= date_trunc('day', now())
    `);
    const raw = (rows as unknown as { rows: { spent: string | number }[] }).rows[0]?.spent ?? 0;
    return Number(raw) || 0;
  }

  /**
   * 预算状态。带 30 秒缓存 —— 每个 AI 请求都查一次库没必要，
   * 但缓存太久又会让超支拦不住，30 秒是折中。
   */
  async budgetStatus(force = false): Promise<{
    budgetMicro: number;
    spentMicro: number;
    remainingMicro: number;
    overBudget: boolean;
    usedPercent: number;
  }> {
    const now = Date.now();
    if (force || !this.budgetCache || now - this.budgetCache.at > BUDGET_CACHE_MS) {
      const [budgetMicro, spentMicro] = await Promise.all([this.getDailyBudgetMicro(), this.spentTodayMicro()]);
      this.budgetCache = { at: now, budgetMicro, spentMicro };
    }
    const { budgetMicro, spentMicro } = this.budgetCache;
    const overBudget = budgetMicro > 0 && spentMicro >= budgetMicro;
    return {
      budgetMicro,
      spentMicro,
      remainingMicro: budgetMicro > 0 ? Math.max(0, budgetMicro - spentMicro) : 0,
      overBudget,
      usedPercent: budgetMicro > 0 ? Math.min(100, Math.round((spentMicro / budgetMicro) * 100)) : 0,
    };
  }

  // ==================== 聚合（后台看板用） ====================

  async summary(days = 7) {
    const since = new Date(Date.now() - days * 86400000);
    const totals = await this.db.execute(sql`
      select
        count(*)::int                                                    as calls,
        coalesce(sum(cost_micro), 0)::bigint                             as cost_micro,
        coalesce(sum(prompt_tokens), 0)::bigint                          as prompt_tokens,
        coalesce(sum(completion_tokens), 0)::bigint                      as completion_tokens,
        coalesce(round(avg(latency_ms)), 0)::int                         as avg_latency,
        sum(case when degraded then 1 else 0 end)::int                   as degraded_calls,
        count(distinct conversation_id)::int                             as conversations,
        count(distinct user_id)::int                                     as users
      from ai_usage where created_at >= ${since}
    `);
    const t = (totals as unknown as { rows: Record<string, unknown>[] }).rows[0] ?? {};

    const byDay = await this.db.execute(sql`
      select to_char(date_trunc('day', created_at), 'MM-DD') as day,
             count(*)::int                    as calls,
             coalesce(sum(cost_micro), 0)::bigint as cost_micro
      from ai_usage where created_at >= ${since}
      group by date_trunc('day', created_at) order by date_trunc('day', created_at)
    `);

    const byModel = await this.db.execute(sql`
      select model,
             count(*)::int                        as calls,
             coalesce(sum(prompt_tokens), 0)::bigint      as prompt_tokens,
             coalesce(sum(completion_tokens), 0)::bigint  as completion_tokens,
             coalesce(sum(cost_micro), 0)::bigint         as cost_micro
      from ai_usage where created_at >= ${since}
      group by model order by cost_micro desc
    `);

    const byScene = await this.db.execute(sql`
      select coalesce(scene, '(未标注)') as scene,
             count(*)::int                as calls,
             coalesce(sum(cost_micro), 0)::bigint as cost_micro
      from ai_usage where created_at >= ${since}
      group by scene order by cost_micro desc
    `);

    const byKind = await this.db.execute(sql`
      select kind, count(*)::int as calls, coalesce(sum(cost_micro), 0)::bigint as cost_micro
      from ai_usage where created_at >= ${since}
      group by kind order by cost_micro desc
    `);

    const topUsers = await this.db.execute(sql`
      select u.id as user_id, u.nickname,
             count(*)::int                       as calls,
             coalesce(sum(a.cost_micro), 0)::bigint as cost_micro
      from ai_usage a left join app_user u on u.id = a.user_id
      where a.created_at >= ${since} and a.user_id is not null
      group by u.id, u.nickname order by cost_micro desc limit 10
    `);

    const topConversations = await this.db.execute(sql`
      select conversation_id,
             count(*)::int                       as calls,
             coalesce(sum(cost_micro), 0)::bigint as cost_micro
      from ai_usage
      where created_at >= ${since} and conversation_id is not null
      group by conversation_id order by cost_micro desc limit 10
    `);

    const r = <T>(x: unknown) => (x as unknown as { rows: T[] }).rows;
    const budget = await this.budgetStatus(true);

    return {
      days,
      totals: {
        calls: Number(t.calls ?? 0),
        costMicro: Number(t.cost_micro ?? 0),
        costText: formatCost(Number(t.cost_micro ?? 0)),
        promptTokens: Number(t.prompt_tokens ?? 0),
        completionTokens: Number(t.completion_tokens ?? 0),
        avgLatencyMs: Number(t.avg_latency ?? 0),
        degradedCalls: Number(t.degraded_calls ?? 0),
        degradedRate: Number(t.calls ?? 0) > 0 ? Math.round((Number(t.degraded_calls ?? 0) / Number(t.calls)) * 100) : 0,
        conversations: Number(t.conversations ?? 0),
        users: Number(t.users ?? 0),
        avgCostPerCallMicro: Number(t.calls ?? 0) > 0 ? Math.round(Number(t.cost_micro ?? 0) / Number(t.calls)) : 0,
      },
      budget,
      byDay: r<{ day: string; calls: number; cost_micro: string }>(byDay).map((x) => ({
        day: x.day, calls: Number(x.calls), costMicro: Number(x.cost_micro), costText: formatCost(Number(x.cost_micro)),
      })),
      byModel: r<Record<string, unknown>>(byModel).map((x) => ({
        model: String(x.model),
        calls: Number(x.calls),
        promptTokens: Number(x.prompt_tokens),
        completionTokens: Number(x.completion_tokens),
        costMicro: Number(x.cost_micro),
        costText: formatCost(Number(x.cost_micro)),
      })),
      byScene: r<Record<string, unknown>>(byScene).map((x) => ({
        scene: String(x.scene), calls: Number(x.calls), costMicro: Number(x.cost_micro), costText: formatCost(Number(x.cost_micro)),
      })),
      byKind: r<Record<string, unknown>>(byKind).map((x) => ({
        kind: String(x.kind), calls: Number(x.calls), costMicro: Number(x.cost_micro), costText: formatCost(Number(x.cost_micro)),
      })),
      topUsers: r<Record<string, unknown>>(topUsers).map((x) => ({
        userId: x.user_id === null ? null : Number(x.user_id),
        nickname: (x.nickname as string) ?? '（已注销）',
        calls: Number(x.calls),
        costMicro: Number(x.cost_micro),
        costText: formatCost(Number(x.cost_micro)),
      })),
      topConversations: r<Record<string, unknown>>(topConversations).map((x) => ({
        conversationId: Number(x.conversation_id),
        calls: Number(x.calls),
        costMicro: Number(x.cost_micro),
        costText: formatCost(Number(x.cost_micro)),
      })),
    };
  }

  /** 按会话算钱：给「会话回放」页面显示这段对话花了多少 */
  async costByConversation(conversationId: number): Promise<{ costMicro: number; costText: string; calls: number }> {
    const rows = await this.db.execute(sql`
      select count(*)::int as calls, coalesce(sum(cost_micro), 0)::bigint as cost_micro
      from ai_usage where conversation_id = ${conversationId}
    `);
    const x = (rows as unknown as { rows: Record<string, unknown>[] }).rows[0] ?? {};
    const costMicro = Number(x.cost_micro ?? 0);
    return { costMicro, costText: formatCost(costMicro), calls: Number(x.calls ?? 0) };
  }
}
