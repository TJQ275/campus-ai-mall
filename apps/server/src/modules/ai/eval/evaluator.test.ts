import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCase, summarize, compareWithBaseline, type ObservedRun } from './evaluator.js';
import type { EvalCase } from './cases.js';

const base: ObservedRun = { tools: [], answer: '', cards: 0, pendingActions: 0, degraded: false, latencyMs: 100 };

test('工具命中：调用到期望的工具即通过', () => {
  const c: EvalCase = { id: 't1', scene: 'shopping', message: 'x', expectAnyTools: ['search_products'] };
  assert.equal(evaluateCase(c, { ...base, tools: ['search_products'] }).passed, true);
  assert.equal(evaluateCase(c, { ...base, tools: ['get_cart'] }).passed, false);
});

test('工具命中是「任一」而非「全部」', () => {
  const c: EvalCase = { id: 't2', scene: 'shopping', message: 'x', expectAnyTools: ['a', 'b'] };
  assert.equal(evaluateCase(c, { ...base, tools: ['b'] }).passed, true);
});

test('答案要点：每组至少命中一个关键词', () => {
  const c: EvalCase = { id: 't3', scene: 'support', message: 'x', expectAny: [['7天', '七天'], ['无理由']] };
  assert.equal(evaluateCase(c, { ...base, answer: '支持 7天 无理由退款' }).passed, true);
  assert.equal(evaluateCase(c, { ...base, answer: '支持 七天 无理由退款' }).passed, true);
  assert.equal(evaluateCase(c, { ...base, answer: '支持 7天 退款' }).passed, false);
});

test('禁止内容命中即失败（幻觉/提示词泄漏）', () => {
  const c: EvalCase = { id: 't4', scene: 'shopping', message: 'x', forbid: ['【硬性规则】'] };
  assert.equal(evaluateCase(c, { ...base, answer: '这是规则' }).passed, true);
  assert.equal(evaluateCase(c, { ...base, answer: '【硬性规则】1. 不许编造' }).passed, false);
});

test('expectNoTools 对「多调一个也算错」', () => {
  const c: EvalCase = { id: 't5', scene: 'shopping', message: '你好', expectNoTools: true };
  assert.equal(evaluateCase(c, { ...base, tools: [] }).passed, true);
  assert.equal(evaluateCase(c, { ...base, tools: ['search_products'] }).passed, false);
});

test('expectPendingAction 检查写操作是否走了确认', () => {
  const c: EvalCase = { id: 't6', scene: 'shopping', message: '加购', expectPendingAction: true };
  assert.equal(evaluateCase(c, { ...base, pendingActions: 1 }).passed, true);
  assert.equal(evaluateCase(c, { ...base, pendingActions: 0 }).passed, false);
});

test('执行异常直接判失败', () => {
  const c: EvalCase = { id: 't7', scene: 'shopping', message: 'x' };
  const r = evaluateCase(c, { ...base, error: '模型调用失败' });
  assert.equal(r.passed, false);
  assert.ok(r.checks.some((x) => x.name === '执行无异常' && !x.ok));
});

test('汇总：各分项比率与失败列表', () => {
  const mk = (id: string, passed: boolean, checks: { name: string; ok: boolean; detail: string }[]): any => ({
    id, scene: 'shopping', message: '', passed, checks, observed: base,
  });
  const results = [
    mk('a', true, [{ name: '工具命中', ok: true, detail: '' }]),
    mk('b', false, [{ name: '工具命中', ok: false, detail: '' }]),
    mk('c', true, [{ name: '禁止内容', ok: true, detail: '' }]),
    mk('d', false, [{ name: '禁止内容', ok: false, detail: '' }]),
  ];
  const s = summarize(results);
  assert.equal(s.total, 4);
  assert.equal(s.passed, 2);
  assert.equal(s.passRate, 50);
  assert.equal(s.toolHitRate, 50);
  assert.equal(s.violations, 1);
  assert.deepEqual(s.failedIds, ['b', 'd']);
});

test('基线的方向性：违规数与延迟是「越低越好」', () => {
  const before: any = { passRate: 80, toolHitRate: 80, answerHitRate: 80, restraintRate: 100, confirmRate: 100, violations: 1, avgLatencyMs: 3000 };
  const now: any = { ...before, passRate: 90, violations: 3, avgLatencyMs: 4000 };
  const cmp = compareWithBaseline(now, before);
  assert.ok(cmp);
  assert.equal(cmp.metrics.find((m) => m.label === '综合通过率')!.worse, false);
  assert.equal(cmp.metrics.find((m) => m.label === '违规用例数')!.worse, true);
  assert.equal(cmp.metrics.find((m) => m.label === '平均延迟')!.worse, true);
  assert.equal(cmp.regressions.length, 2);
});

test('没有基线时返回 null，不炸', () => {
  assert.equal(compareWithBaseline({} as any, null), null);
});
