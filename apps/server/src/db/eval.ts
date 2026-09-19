// reflect-metadata 必须第一个导入：没有它，TS 不会发出 design:paramtypes 元数据，
// Nest 就解析不出构造函数里「只靠类型」注入的参数，报
// UndefinedDependencyException: Nest can't resolve dependencies of the JwtAuthGuard (?, Symbol(DB))。
// 报错信息会误导你去查 import type / 循环依赖，其实是缺这一行。
import 'reflect-metadata';
import './env.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { AgentService } from '../modules/ai/agent.service.js';
import { createDb } from './client.js';
import { users } from './schema/index.js';
import { EVAL_CASES, casesByScene, type EvalCase } from '../modules/ai/eval/cases.js';
import {
  evaluateCase, summarize, compareWithBaseline,
  type CaseResult, type EvalSummary, type ObservedRun,
} from '../modules/ai/eval/evaluator.js';

/**
 * AI 评测：pnpm ai:eval [--scene=shopping] [--limit=10] [--save-baseline] [--verbose]
 *
 * 干的事：拿一批固定用例去问 Agent，把「调了哪些工具、答了什么、有没有编造」记下来，
 * 按固定规则打分，然后和上次的基线比 —— 改 prompt / 换模型之后跑一遍就知道是变好还是变坏。
 *
 * 注意：跑评测会真实调用大模型（要花钱、要时间）。没配 Key 时走 MockProvider，
 * 指标会明显偏低，那是正常的 —— Mock 是规则引擎，接不住这些问法。
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.some((a) => a === '--' + name);
const value = (name: string) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : undefined;
};

const EVAL_DIR = path.resolve(process.cwd(), '.eval');
const BASELINE_FILE = path.join(EVAL_DIR, 'baseline.json');

/** 评测用的专用账号：和真实用户数据分开，方便单独清理 */
async function ensureEvalUser(db: Awaited<ReturnType<typeof createDb>>['db']): Promise<number> {
  const existing = (await db.select().from(users).where(eq(users.username, 'eval-bot')).limit(1))[0];
  if (existing) return existing.id;
  const created = await db
    .insert(users)
    .values({ username: 'eval-bot', nickname: '评测机器人', role: 'user', balanceCents: 100000 })
    .returning({ id: users.id });
  console.log('[eval] 已创建评测专用账号 eval-bot (id=' + created[0].id + ')');
  return created[0].id;
}

/** 跑一条用例，把事件流收敛成可判定的观测结果 */
async function runCase(agent: AgentService, userId: number, c: EvalCase): Promise<ObservedRun> {
  const started = Date.now();
  const tools: string[] = [];
  let answer = '';
  let cards = 0;
  let pendingActions = 0;
  let degraded = false;
  let error: string | undefined;

  try {
    for await (const event of agent.run(userId, { message: c.message, scene: c.scene }, {})) {
      switch (event.type) {
        case 'text':
          answer += event.delta;
          break;
        case 'tool_start':
          tools.push(event.toolName);
          break;
        case 'cards':
          cards += event.products.length;
          break;
        case 'action_confirm':
          pendingActions += 1;
          break;
        case 'usage':
          if (event.degraded) degraded = true;
          break;
        case 'error':
          error = event.message;
          break;
        default:
          break;
      }
    }
  } catch (e) {
    error = (e as Error).message ?? String(e);
  }

  return { tools, answer, cards, pendingActions, degraded, latencyMs: Date.now() - started, error };
}

function printReport(results: CaseResult[], summary: EvalSummary, comparison: ReturnType<typeof compareWithBaseline>, verbose: boolean) {
  console.log('');
  console.log('='.repeat(64));
  console.log('  AI 评测报告');
  console.log('='.repeat(64));
  console.log('  用例总数        ' + summary.total);
  console.log('  通过            ' + summary.passed + ' / ' + summary.total + '   (' + summary.passRate + '%)');
  console.log('  工具命中率      ' + summary.toolHitRate + '%  (' + summary.toolCases + ' 条有工具期望)');
  console.log('  答案要点命中率  ' + summary.answerHitRate + '%  (' + summary.answerCases + ' 条有要点期望)');
  console.log('  克制率          ' + summary.restraintRate + '%  (' + summary.restraintCases + ' 条要求不乱动)');
  console.log('  写操作确认率    ' + summary.confirmRate + '%  (' + summary.confirmCases + ' 条要求走确认)');
  console.log('  违规用例        ' + summary.violations + ' 条  (幻觉 / 提示词泄漏)');
  console.log('  降级用例        ' + summary.degradedCases + ' 条');
  console.log('  平均延迟        ' + summary.avgLatencyMs + ' ms');
  console.log('');
  console.log('  按场景:');
  for (const [scene, s] of Object.entries(summary.byScene)) {
    console.log('    ' + scene.padEnd(10) + s.passed + '/' + s.total + '  (' + s.passRate + '%)');
  }

  if (comparison) {
    console.log('');
    console.log('  与基线对比:');
    for (const m of comparison.metrics) {
      const arrow = m.delta === 0 ? '  =  ' : m.worse ? '  ↓  ' : '  ↑  ';
      const deltaText = (m.delta > 0 ? '+' : '') + m.delta + m.unit;
      console.log('    ' + m.label.padEnd(24) + String(m.before).padStart(8) + arrow + String(m.now).padStart(8) + '  (' + deltaText + ')');
    }
    if (comparison.regressions.length) {
      console.log('');
      console.log('  ⚠ 有指标退步: ' + comparison.regressions.map((r) => r.label).join(', '));
    }
  } else {
    console.log('');
    console.log('  （还没有基线。加 --save-baseline 把这次结果存为基线，下次就能对比了）');
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    console.log('');
    console.log('  未通过的用例 (' + failed.length + '):');
    for (const r of failed) {
      const bad = r.checks.filter((c) => !c.ok).map((c) => c.name + ': ' + c.detail).join(' | ');
      console.log('    ✗ ' + r.id.padEnd(10) + bad);
      if (verbose) console.log('        问: ' + r.message + '\n        答: ' + r.observed.answer.slice(0, 160).replace(/\n/g, ' '));
    }
  }
  console.log('');
}

async function main() {
  const scene = value('scene') as EvalCase['scene'] | undefined;
  const limit = Number(value('limit') ?? 0) || 0;
  let cases = scene ? casesByScene(scene) : EVAL_CASES;
  if (limit > 0) cases = cases.slice(0, limit);

  console.log('[eval] 用例 ' + cases.length + ' 条' + (scene ? '，场景 ' + scene : ''));

  const handle = await createDb();
  const userId = await ensureEvalUser(handle.db);
  await handle.close();

  // 用真正的应用上下文跑：确保评测走的是和线上完全一样的工具装配与提示词
  // 用 NestFactory.create 而不是 createApplicationContext：
  // 后者在解析 @Global() 模块里的 JwtAuthGuard 时会报 UndefinedDependencyException，
  // 而 create + 不 listen 走的是和线上完全一样的装配路径。
  // 另外别用 logger: false —— 那会把启动失败的原因一起吞掉，表现成「跑两条就静默退出」。
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  // 必须显式 init()：NestFactory.create 不会自动触发 onModuleInit，
  // 而 LlmService.init() 正是在那里从数据库读大模型配置的。
  // 漏掉这一步的表现很隐蔽 —— 评测能跑完、指标也像模像样，但全程走的是 MockProvider，
  // 等于在评测一个规则引擎而不是真模型（降级用例数会等于用例总数）。
  await app.init();
  const agent = app.get(AgentService);

  const results: CaseResult[] = [];
  let index = 0;
  for (const c of cases) {
    index += 1;
    process.stdout.write('  [' + String(index).padStart(2) + '/' + cases.length + '] ' + c.id.padEnd(10));
    const observed = await runCase(agent, userId, c);
    const result = evaluateCase(c, observed);
    results.push(result);
    console.log(result.passed ? '通过' : '未通过  (' + result.checks.filter((x) => !x.ok).map((x) => x.name).join(',') + ')');
  }

  await app.close();

  const summary = summarize(results);
  // 基线带上作用域。只跑单场景时去和「全量基线」比会得出完全错误的退步结论 ——
  // 我就踩过：support 单场景 23/24 对上全量基线的 98.2%，被报成「综合通过率退步 2.4%」。
  let baseline: EvalSummary | null = null;
  let baselineScope = '';
  if (fs.existsSync(BASELINE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
      // 兼容两种格式：新的 { scope, summary } 和旧的裸 summary
      if (raw && raw.summary) { baseline = raw.summary; baselineScope = raw.scope ?? ''; }
      else { baseline = raw; baselineScope = ''; }
    } catch { baseline = null; }
  }

  const currentScope = scene ?? 'all';
  const scopeMatches = baselineScope === currentScope;
  if (baseline && !scopeMatches) {
    console.log('');
    console.log('  ⚠ 基线作用域是「' + (baselineScope || '未标注') + '」，本次是「' + currentScope + '」，'
      + '两者不可比，已跳过对比。要对比请用相同的 --scene 参数，或跑全量。');
    baseline = null;
  }

  printReport(results, summary, compareWithBaseline(summary, baseline), flag('verbose'));

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(EVAL_DIR, 'run-' + stamp + '.json');
  fs.writeFileSync(reportFile, JSON.stringify({ summary, results }, null, 2));
  console.log('[eval] 明细已保存: ' + reportFile);

  if (flag('save-baseline')) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ scope: currentScope, savedAt: new Date().toISOString(), summary }, null, 2));
    console.log('[eval] 已存为基线（作用域: ' + currentScope + '）: ' + BASELINE_FILE);
  }

  // 有未通过用例时以非 0 退出，方便接进 CI 卡住退步
  if (summary.passed < summary.total) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[eval] 失败:', error);
  process.exit(1);
});