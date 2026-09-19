/**
 * Agent 工作流：把「一问一答」拆成有名字、可观测的阶段，并在作答前做**规则校验**。
 *
 * 为什么要显式化阶段：
 *   单一 ReAct 循环的问题是「过程不可解释」—— 出问题时你只知道模型答错了，
 *   不知道它是在理解阶段就跑偏了，还是执行阶段没调工具，还是压根没校验。
 *   把阶段命名并暴露出去之后，后台能看到每一次对话走到哪一步、卡在哪一步。
 *
 * 为什么要一个独立的校验阶段：
 *   模型会「声称做过某件事」，而实际没做。这不是普通的幻觉 ——
 *   用户会以为购物车里真有商品、售后真的提交了。这类错误必须在**发给用户之前**拦掉。
 *   这里的规则是从真实事故反推出来的（见下方每条规则的注释）。
 *
 * 本文件是纯函数，不依赖 Nest、不碰数据库，因此可以被单元测试完整覆盖。
 */

/** 工作流阶段。顺序即执行顺序 */
export type WorkflowStage = 'understand' | 'plan' | 'act' | 'verify' | 'respond';

export const STAGE_LABEL: Record<WorkflowStage, string> = {
  understand: '理解意图',
  plan: '规划步骤',
  act: '执行工具',
  verify: '校验回答',
  respond: '生成回复',
};

export interface VerifyIssue {
  /** 规则代号，便于在监控里聚合 */
  rule: string;
  /** block = 不允许直接发给用户；warn = 记录但不拦截 */
  severity: 'block' | 'warn';
  detail: string;
}

export interface VerifyInput {
  userMessage: string;
  answer: string;
  scene: string;
  /** 本轮实际调用过的工具名 */
  toolsCalled: string[];
  /** 其中属于「写操作」的工具名（加购、申请售后这类） */
  writeToolsCalled: string[];
  /** 本轮产生的待用户确认的写操作数量 */
  pendingActionCount: number;
  /** 所有工具结果拼成的一段文本，用来判断答案里的数字是否有出处 */
  toolContext: string;
}

/** 用户表达了「要办一件事」的意图 */
const WRITE_INTENT = /加购|加入购物车|加到购物车|放进购物车|下单|买了|购买|申请售后|申请退款|退款|退货|换货/;

/** 写操作的动作词 */
// 中文的动作说法很多（「申请退款」和「退款申请」都有），这里列全一点，
// 漏掉的后果是假成功检测失效 —— 比多列几个词严重得多。
const ACTION_VERB =
  /(加入购物车|加到购物车|加进购物车|加购|下单|提交订单|提交申请|提交退款|提交售后|申请退款|申请售后|退款申请|售后申请|发起退款|发起售后|退款成功|退款已|退货|换货|下架)/g;

/** 表示「已经做完」的标记 */
const COMPLETION_MARK = /(已|成功|完成|办好了|搞定了|处理好了)/;

/** 往前看多少个字符找完成标记 */
const CLAIM_LOOKBACK = 24;

/**
 * 助手是否在**声称已经完成**了某个写操作。
 *
 * 为什么不用一条正则：中文会把动作词和完成标记隔开很远 ——
 * 「已把『卫龙大面筋辣条 106g』加入购物车」里，『已』和『加入购物车』隔了 15 个字。
 * 一条写死的正则会漏掉这种最常见的情况。改成「找到动作词 → 往前找完成标记」更稳。
 *
 * 这里宁可宽松一点：它只是 R1 的**必要条件之一**，
 * 还要同时满足「没调写工具」和「没有待确认动作」才会真正阻断，所以误判代价很小。
 */
export function claimsCompletion(answer: string): boolean {
  for (const m of answer.matchAll(ACTION_VERB)) {
    const at = m.index ?? 0;
    const window = answer.slice(Math.max(0, at - CLAIM_LOOKBACK), at);
    if (COMPLETION_MARK.test(window)) return true;
  }
  return false;
}

/** 把答案里的金额抽出来：既认「3.50 元」也认「¥3.50」 */
function extractAmounts(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/g)) out.add(Number(m[1]));
  for (const m of text.matchAll(/(\d+(?:\.\d{1,2})?)\s*元/g)) out.add(Number(m[1]));
  return [...out].filter((n) => Number.isFinite(n));
}

/** 工具结果里出现过的所有数字（价格、库存、数量、百分比都算） */
function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d+(?:\.\d{1,2})?/g)) out.add(Number(m[0]));
  return out;
}

/**
 * 校验一次回答。返回空数组表示没问题。
 *
 * 规则都是从**真实事故**反推的，不是凭空设想的：
 *   R1 假成功  —— 评测实测：模型说「已把商品加入购物车」，而工具链里根本没有 add_to_cart
 *   R2 假价格  —— 提示词已要求价格必须来自工具，这里做兜底检查
 *   R3 无出处  —— 客服场景的政策回答应当引用知识库来源
 *   R4 空回复  —— 工具轮次耗尽时曾出现「用户什么都没收到」
 */
export function verifyAnswer(input: VerifyInput): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const answer = input.answer ?? '';
  const trimmed = answer.trim();

  // R4：空回复。比答错更糟 —— 用户完全不知道发生了什么
  if (!trimmed) {
    issues.push({ rule: 'R4_EMPTY_ANSWER', severity: 'block', detail: '回答为空，用户会以为助手没反应' });
    return issues;
  }

  // R1：声称完成了写操作，但既没有调用写工具、也没有生成待确认动作
  const hasWriteIntent = WRITE_INTENT.test(input.userMessage);
  const claimsDone = claimsCompletion(trimmed);
  if (hasWriteIntent && claimsDone && input.writeToolsCalled.length === 0 && input.pendingActionCount === 0) {
    issues.push({
      rule: 'R1_FALSE_COMPLETION',
      severity: 'block',
      detail: '用户要求的是操作，回答声称已完成，但本轮没有调用任何写操作工具、也没有生成待确认动作',
    });
  }

  // R2：答案里的金额在工具结果里找不到出处。
  // 已知数字要把**用户自己的话**也算进去 —— 用户问「20 块钱以内买什么」，
  // 回答里出现 20 是完全正确的，不把它算进去会刷出一堆无意义的告警，
  // 告警一多就没人看了，这条规则也就废了。
  const known = numbersIn(input.toolContext);
  for (const n of numbersIn(input.userMessage)) known.add(n);
  const fabricated = extractAmounts(trimmed).filter((n) => !known.has(n));
  if (fabricated.length) {
    issues.push({
      rule: 'R2_UNSOURCED_PRICE',
      severity: 'warn',
      detail: '答案里的金额在工具结果中找不到出处: ' + fabricated.join(', ') + ' 元',
    });
  }

  // R3：客服回答没有给出来源
  if (input.scene === 'support' && input.toolsCalled.includes('search_knowledge') && !/《|》|根据|依据/.test(trimmed)) {
    issues.push({
      rule: 'R3_MISSING_CITATION',
      severity: 'warn',
      detail: '走了知识库检索，但回答里没有引用来源',
    });
  }

  return issues;
}

/** 有 block 级问题就不能原样发给用户 */
export function hasBlockingIssue(issues: VerifyIssue[]): boolean {
  return issues.some((i) => i.severity === 'block');
}

/**
 * 针对校验问题生成「纠正指令」，让模型带着明确要求重写一遍。
 * 不给它指出具体错在哪，重写一次大概率还是错。
 */
export function buildCorrectionPrompt(issues: VerifyIssue[]): string {
  const lines = issues.map((i) => '- ' + i.detail);
  return [
    '（系统校验）你刚才的回答存在以下问题，请重写：',
    ...lines,
    '',
    '重写要求：',
    '如果某件事你并没有真正执行（工具没有返回执行结果），必须如实说明「还没有完成」，',
    '并告诉用户可以再说一次或点击确认；绝对不要声称已经完成。',
    '用中文回答，控制在 3 句话以内。',
  ].join('\n');
}
