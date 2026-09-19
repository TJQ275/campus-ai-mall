import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrectionPrompt, hasBlockingIssue, verifyAnswer, type VerifyInput } from './workflow.js';

function input(patch: Partial<VerifyInput> = {}): VerifyInput {
  return {
    userMessage: '有没有辣条推荐',
    answer: '有卫龙大面筋和麻辣王子两款。',
    scene: 'shopping',
    toolsCalled: ['search_products'],
    writeToolsCalled: [],
    pendingActionCount: 0,
    toolContext: 'search_products 找到 2 件商品 卫龙大面筋辣条 ¥3.50 麻辣王子 ¥4.00',
    ...patch,
  };
}

test('正常回答不报问题', () => {
  assert.deepEqual(verifyAnswer(input()), []);
});

// ==================== R1：假的成功确认（最重要的一条） ====================

test('R1：声称已加购但没调用写工具、也没有待确认动作 → 阻断', () => {
  // 这是评测实测到的真实事故：模型说「已加入购物车」，工具链里只有 search_products
  const issues = verifyAnswer(input({
    userMessage: '把卫龙辣条加到购物车',
    answer: '已把「卫龙大面筋辣条 106g」加入购物车，确认后即生效。',
    toolsCalled: ['get_user_profile', 'search_products'],
    writeToolsCalled: [],
    pendingActionCount: 0,
  }));
  assert.equal(hasBlockingIssue(issues), true);
  assert.equal(issues[0].rule, 'R1_FALSE_COMPLETION');
});

test('R1：真的调了写工具（生成了待确认动作）就不算假成功', () => {
  const issues = verifyAnswer(input({
    userMessage: '把卫龙辣条加到购物车',
    answer: '已把「卫龙大面筋辣条 106g」加入购物车，确认后即生效。',
    toolsCalled: ['get_user_profile', 'search_products', 'add_to_cart'],
    writeToolsCalled: ['add_to_cart'],
    pendingActionCount: 1,
  }));
  assert.equal(hasBlockingIssue(issues), false, '正常的两阶段确认话术不该被拦');
});

test('R1：用户只是问政策、助手说「退款已处理」但没有写操作 → 阻断', () => {
  const issues = verifyAnswer(input({
    userMessage: '我要申请退款',
    answer: '已经帮你提交退款申请了。',
    scene: 'support',
    toolsCalled: ['search_knowledge'],
    writeToolsCalled: [],
    pendingActionCount: 0,
  }));
  assert.equal(hasBlockingIssue(issues), true);
});

test('R1：用户没表达办事情的意图时，不触发（避免误伤）', () => {
  const issues = verifyAnswer(input({
    userMessage: '退款政策是什么',
    answer: '零食支持 7 天无理由退款，已拆封的不支持。',
    scene: 'support',
    toolsCalled: ['search_knowledge'],
  }));
  assert.equal(hasBlockingIssue(issues), false);
});

test('R1：「确认后生效」这种正确话术不算完成声明', () => {
  const issues = verifyAnswer(input({
    userMessage: '加两包薯片',
    answer: '好的，已经准备好，确认后就会加入购物车。',
    toolsCalled: ['add_to_cart'],
    writeToolsCalled: ['add_to_cart'],
    pendingActionCount: 1,
  }));
  assert.equal(hasBlockingIssue(issues), false);
});

// ==================== R2：金额出处 ====================

test('R2：答案里的价格在工具结果里找不到出处 → 告警（不阻断）', () => {
  const issues = verifyAnswer(input({ answer: '这款辣条只要 ¥9.90。' }));
  const r2 = issues.find((i) => i.rule === 'R2_UNSOURCED_PRICE');
  assert.ok(r2);
  assert.equal(r2.severity, 'warn');
  assert.equal(hasBlockingIssue(issues), false, '金额问题只告警，不阻断回答');
});

test('R2：价格有出处就不报', () => {
  const issues = verifyAnswer(input({ answer: '卫龙大面筋 3.50 元，麻辣王子 4.00 元。' }));
  assert.equal(issues.filter((i) => i.rule === 'R2_UNSOURCED_PRICE').length, 0);
});

test('R2：用户自己提到的金额不算编造', () => {
  // 用户问「20 块钱以内买什么」，回答里出现 20 是应该的
  const issues = verifyAnswer(input({
    userMessage: '20 块钱以内能买点什么',
    answer: '20 元以内可以这样搭：辣条 + 冰红茶。',
    toolContext: 'search_products 找到 3 件商品 卫龙大面筋辣条 ¥3.50',
  }));
  assert.equal(issues.filter((i) => i.rule === 'R2_UNSOURCED_PRICE').length, 0);
});

test('R2：同时支持 ¥ 前缀和「元」后缀两种写法', () => {
  const issues = verifyAnswer(input({ answer: '总共 ¥3.50，也就是 3.50 元。' }));
  assert.equal(issues.filter((i) => i.rule === 'R2_UNSOURCED_PRICE').length, 0);
});

// ==================== R3：政策引用 ====================

test('R3：走了知识库但没引用来源 → 告警', () => {
  const issues = verifyAnswer(input({
    userMessage: '退款政策是什么',
    answer: '零食支持 7 天内无理由退款。',
    scene: 'support',
    toolsCalled: ['search_knowledge'],
    toolContext: 'search_knowledge 命中 2 条条款 退款政策',
  }));
  const r3 = issues.find((i) => i.rule === 'R3_MISSING_CITATION');
  assert.ok(r3);
  assert.equal(r3.severity, 'warn');
});

test('R3：有《》引用就通过', () => {
  const issues = verifyAnswer(input({
    userMessage: '退款政策是什么',
    answer: '根据《退款政策》，零食支持 7 天内无理由退款。',
    scene: 'support',
    toolsCalled: ['search_knowledge'],
  }));
  assert.equal(issues.filter((i) => i.rule === 'R3_MISSING_CITATION').length, 0);
});

test('R3：非客服场景不要求引用', () => {
  const issues = verifyAnswer(input({
    userMessage: '有没有辣条',
    answer: '有两款辣条。',
    scene: 'shopping',
    toolsCalled: ['search_products'],
  }));
  assert.equal(issues.filter((i) => i.rule === 'R3_MISSING_CITATION').length, 0);
});

// ==================== R4：空回复 ====================

test('R4：空回复 → 阻断，并且直接返回不再检查其它规则', () => {
  const issues = verifyAnswer(input({ answer: '   ' }));
  assert.equal(hasBlockingIssue(issues), true);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'R4_EMPTY_ANSWER');
});

// ==================== 纠正指令 ====================

test('纠正指令要把具体问题写进去，否则模型不知道改什么', () => {
  const prompt = buildCorrectionPrompt([
    { rule: 'R1_FALSE_COMPLETION', severity: 'block', detail: '声称已完成但没调用写操作工具' },
  ]);
  assert.match(prompt, /声称已完成但没调用写操作工具/);
  assert.match(prompt, /不要声称已经完成|如实说明/);
});

test('hasBlockingIssue：只有告警时不算阻断', () => {
  assert.equal(hasBlockingIssue([{ rule: 'R2_UNSOURCED_PRICE', severity: 'warn', detail: 'x' }]), false);
  assert.equal(hasBlockingIssue([{ rule: 'R1_FALSE_COMPLETION', severity: 'block', detail: 'x' }]), true);
  assert.equal(hasBlockingIssue([]), false);
});
