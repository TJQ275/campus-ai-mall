/**
 * 评测的判定与打分逻辑。
 *
 * 刻意写成**纯函数**：输入是用例定义 + 实际观测，输出是逐项检查结果。
 * 这样判定规则本身可以被单元测试覆盖，改评分标准时不会悄悄改坏。
 */
import type { EvalCase } from './cases.js';

/** 跑一次用例观测到的结果 */
export interface ObservedRun {
  /** 实际被调用的工具名，按调用顺序 */
  tools: string[];
  /** 模型最终回复的文本 */
  answer: string;
  /** 产出的商品卡片数量 */
  cards: number;
  /** 触发的写操作待确认数量 */
  pendingActions: number;
  /** 是否走了降级（Mock）*/
  degraded: boolean;
  latencyMs: number;
  /** 执行期异常（有值即视为该用例失败） */
  error?: string;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CaseResult {
  id: string;
  scene: string;
  message: string;
  note?: string;
  passed: boolean;
  checks: Check[];
  observed: ObservedRun;
}

/** 判定单个用例：所有检查项都通过才算通过 */
export function evaluateCase(c: EvalCase, run: ObservedRun): CaseResult {
  const checks: Check[] = [];
  const tools = run.tools;

  if (c.expectAnyTools?.length) {
    const hit = c.expectAnyTools.filter((t) => tools.includes(t));
    checks.push({
      name: '工具命中', ok: hit.length > 0,
      detail: hit.length ? '命中 ' + hit.join(',') : '期望 ' + c.expectAnyTools.join('/') + '，实际 ' + (tools.join(',') || '未调用'),
    });
  }

  if (c.expectNoTools) {
    checks.push({
      name: '未调用工具', ok: tools.length === 0,
      detail: tools.length ? '实际调用了 ' + tools.join(',') : '未调用',
    });
  }

  if (c.expectNoCards) {
    checks.push({
      name: '未产出卡片', ok: run.cards === 0,
      detail: run.cards ? '产出了 ' + run.cards + ' 张卡片' : '无卡片',
    });
  }

  if (c.expectPendingAction) {
    checks.push({
      name: '写操作待确认', ok: run.pendingActions > 0,
      detail: run.pendingActions ? run.pendingActions + ' 个待确认' : '没有触发确认（写操作可能被直接执行了）',
    });
  }

  if (c.expectAny?.length) {
    const misses: string[] = [];
    for (const group of c.expectAny) {
      if (!group.some((k) => run.answer.includes(k))) misses.push(group.join('/'));
    }
    checks.push({
      name: '答案要点', ok: misses.length === 0,
      detail: misses.length ? '缺少「' + misses.join('」「') + '」' : '全部命中',
    });
  }

  if (c.forbid?.length) {
    const violated = c.forbid.filter((w) => run.answer.includes(w));
    checks.push({
      name: '禁止内容', ok: violated.length === 0,
      detail: violated.length ? '出现了 ' + violated.join(',') : '未出现',
    });
  }

  if (run.error) checks.push({ name: '执行无异常', ok: false, detail: run.error });

  // 一条用例如果什么期望都没写，那就只检查「没抛异常」
  if (!checks.length) checks.push({ name: '执行无异常', ok: true, detail: '该用例没有断言' });

  return {
    id: c.id, scene: c.scene, message: c.message, note: c.note,
    passed: checks.every((x) => x.ok),
    checks, observed: run,
  };
}

export interface EvalSummary {
  total: number;
  passed: number;
  passRate: number;
  /** 期望调工具且命中的比例 */
  toolHitRate: number;
  toolCases: number;
  /** 答案要点全部命中的比例 */
  answerHitRate: number;
  answerCases: number;
  /** 该拒答/该闭嘴的用例中，确实没乱调工具的比例 */
  restraintRate: number;
  restraintCases: number;
  /** 幻觉 / 提示词泄漏命中次数 */
  violations: number;
  violationCases: number;
  /** 写操作走确认的比例 */
  confirmRate: number;
  confirmCases: number;
  degradedCases: number;
  avgLatencyMs: number;
  failedIds: string[];
  byScene: Record<string, { total: number; passed: number; passRate: number }>;
}

const rate = (hit: number, total: number) => (total > 0 ? Math.round((hit / total) * 1000) / 10 : 100);

export function summarize(results: CaseResult[]): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  const toolResults = results.filter((r) => r.checks.some((c) => c.name === '工具命中'));
  const toolHits = toolResults.filter((r) => r.checks.find((c) => c.name === '工具命中')?.ok).length;

  const answerResults = results.filter((r) => r.checks.some((c) => c.name === '答案要点'));
  const answerHits = answerResults.filter((r) => r.checks.find((c) => c.name === '答案要点')?.ok).length;

  const restraintResults = results.filter((r) => r.checks.some((c) => c.name === '未调用工具' || c.name === '未产出卡片'));
  const restraintHits = restraintResults.filter((r) =>
    r.checks.filter((c) => c.name === '未调用工具' || c.name === '未产出卡片').every((c) => c.ok),
  ).length;

  const violationResults = results.filter((r) => r.checks.some((c) => c.name === '禁止内容'));
  const violations = violationResults.filter((r) => !r.checks.find((c) => c.name === '禁止内容')?.ok).length;

  const confirmResults = results.filter((r) => r.checks.some((c) => c.name === '写操作待确认'));
  const confirmHits = confirmResults.filter((r) => r.checks.find((c) => c.name === '写操作待确认')?.ok).length;

  const byScene: EvalSummary['byScene'] = {};
  for (const r of results) {
    const bucket = (byScene[r.scene] ??= { total: 0, passed: 0, passRate: 0 });
    bucket.total += 1;
    if (r.passed) bucket.passed += 1;
  }
  for (const key of Object.keys(byScene)) byScene[key].passRate = rate(byScene[key].passed, byScene[key].total);

  const latencies = results.map((r) => r.observed.latencyMs).filter((n) => n > 0);

  return {
    total, passed, passRate: rate(passed, total),
    toolHitRate: rate(toolHits, toolResults.length), toolCases: toolResults.length,
    answerHitRate: rate(answerHits, answerResults.length), answerCases: answerResults.length,
    restraintRate: rate(restraintHits, restraintResults.length), restraintCases: restraintResults.length,
    violations, violationCases: violationResults.length,
    confirmRate: rate(confirmHits, confirmResults.length), confirmCases: confirmResults.length,
    degradedCases: results.filter((r) => r.observed.degraded).length,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    failedIds: results.filter((r) => !r.passed).map((r) => r.id),
    byScene,
  };
}

/** 和基线对比，给出每一项指标的涨跌 */
export function compareWithBaseline(current: EvalSummary, baseline: EvalSummary | null) {
  if (!baseline) return null;
  const metric = (label: string, now: number, before: number, unit = '%') => ({
    label, now, before, delta: Math.round((now - before) * 10) / 10, unit,
    worse: now < before,
  });
  const metrics = [
    metric('综合通过率', current.passRate, baseline.passRate),
    metric('工具命中率', current.toolHitRate, baseline.toolHitRate),
    metric('答案要点命中率', current.answerHitRate, baseline.answerHitRate),
    metric('克制率（不该调工具时没调）', current.restraintRate, baseline.restraintRate),
    metric('写操作确认率', current.confirmRate, baseline.confirmRate),
    metric('违规用例数', current.violations, baseline.violations, ' 条'),
    metric('平均延迟', current.avgLatencyMs, baseline.avgLatencyMs, ' ms'),
  ];
  // 违规数和延迟是「越低越好」，涨了才算变差
  for (const m of metrics) {
    if (m.label === '违规用例数' || m.label === '平均延迟') m.worse = m.now > m.before;
  }
  const regressions = metrics.filter((m) => m.worse && m.delta !== 0);
  return { metrics, regressions, improved: metrics.some((m) => !m.worse && m.delta !== 0) };
}