import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AddCartRequest,
  AddressRequest,
  AdminProductSaveRequest,
  ChatRequest,
  CreateOrderRequest,
  PayOrderRequest,
  RechargeRequest,
  ReviewRequest,
} from '@campus/shared';
import { hashPassword, verifyPassword } from './password.js';
import { safeParse } from '../modules/ai/provider/openai-compatible.provider.js';
import { assertProductionSecrets } from '../config/configuration.js';

/**
 * 入参校验的单元测试。
 * 这些 schema 是接口唯一的运行时防线（全局 ValidationPipe 已移除，见 main.ts 注释），
 * 改动它们等于改动所有接口的边界，所以在这里钉死关键行为。
 */
describe('接口入参 schema', () => {
  it('接受合法的小程序对话请求并补默认场景', () => {
    const parsed = ChatRequest.parse({ message: '想吃辣的' });
    assert.equal(parsed.scene, 'shopping');
    assert.equal(parsed.message, '想吃辣的');
  });

  it('拒绝空消息和超长消息', () => {
    assert.equal(ChatRequest.safeParse({ message: '' }).success, false);
    assert.equal(ChatRequest.safeParse({ message: 'x'.repeat(2001) }).success, false);
    assert.equal(ChatRequest.safeParse({}).success, false);
  });

  it('拒绝超过 3 张的图片附件', () => {
    const result = ChatRequest.safeParse({ message: '看图', imageUrls: ['a', 'b', 'c', 'd'] });
    assert.equal(result.success, false);
  });

  it('加购：数量有上下限，且默认 1', () => {
    assert.equal(AddCartRequest.parse({ productId: 3 }).quantity, 1);
    assert.equal(AddCartRequest.safeParse({ productId: 3, quantity: 0 }).success, false);
    assert.equal(AddCartRequest.safeParse({ productId: 3, quantity: 100 }).success, false);
    assert.equal(AddCartRequest.safeParse({ productId: -1 }).success, false);
    // 字符串数字会被 coerce 成数字（小程序经常把 id 当字符串传）
    assert.equal(AddCartRequest.parse({ productId: '3' }).productId, 3);
  });

  it('地址：手机号必须是 11 位大陆号码', () => {
    const base = { receiver: '张三', detail: '1 号楼 101' };
    assert.equal(AddressRequest.safeParse({ ...base, phone: '13800000000' }).success, true);
    assert.equal(AddressRequest.safeParse({ ...base, phone: '1380000000' }).success, false);
    assert.equal(AddressRequest.safeParse({ ...base, phone: '23800000000' }).success, false);
    assert.equal(AddressRequest.safeParse({ ...base, phone: '138-0000-0000' }).success, false);
  });

  it('下单：必须有地址，来源只能是 miniapp / ai', () => {
    assert.equal(CreateOrderRequest.safeParse({ addressId: 1 }).success, true);
    assert.equal(CreateOrderRequest.safeParse({}).success, false);
    assert.equal(CreateOrderRequest.safeParse({ addressId: 1, source: 'hack' }).success, false);
    assert.equal(CreateOrderRequest.parse({ addressId: 1 }).source, 'miniapp');
  });

  it('支付渠道只接受三种，默认微信', () => {
    assert.equal(PayOrderRequest.parse({}).channel, 'wechat');
    assert.equal(PayOrderRequest.safeParse({ channel: 'paypal' }).success, false);
  });

  it('充值金额必须为正整数分，且不超过 1000 元', () => {
    assert.equal(RechargeRequest.safeParse({ amountCents: 100 }).success, true);
    assert.equal(RechargeRequest.safeParse({ amountCents: 0 }).success, false);
    assert.equal(RechargeRequest.safeParse({ amountCents: -100 }).success, false);
    assert.equal(RechargeRequest.safeParse({ amountCents: 100001 }).success, false);
    assert.equal(RechargeRequest.safeParse({ amountCents: 1.5 }).success, false);
  });

  it('评价：评分 1-5', () => {
    assert.equal(ReviewRequest.safeParse({ productId: 1, rating: 5 }).success, true);
    assert.equal(ReviewRequest.safeParse({ productId: 1, rating: 0 }).success, false);
    assert.equal(ReviewRequest.safeParse({ productId: 1, rating: 6 }).success, false);
  });
});

describe('管理端商品 schema', () => {
  const valid = { kind: 'snack', title: '辣条', categoryId: 1, priceCents: 350 };

  it('接受最小可用字段并补默认值', () => {
    const parsed = AdminProductSaveRequest.parse(valid);
    assert.equal(parsed.stock, 0);
    assert.equal(parsed.status, 'on');
  });

  it('品类和标题是必填', () => {
    assert.equal(AdminProductSaveRequest.safeParse({ ...valid, kind: undefined }).success, false);
    assert.equal(AdminProductSaveRequest.safeParse({ ...valid, title: '  ' }).success, false);
  });

  it('价格必须是分为单位的非负整数', () => {
    assert.equal(AdminProductSaveRequest.safeParse({ ...valid, priceCents: -1 }).success, false);
    assert.equal(AdminProductSaveRequest.safeParse({ ...valid, priceCents: 3.5 }).success, false);
  });

  it('剔除白名单之外的字段（防批量赋值）', () => {
    const parsed = AdminProductSaveRequest.parse({
      ...valid,
      sales: 999999,
      ratingAvg: 5,
      viewCount: 12345,
    }) as Record<string, unknown>;
    assert.equal('sales' in parsed, false);
    assert.equal('ratingAvg' in parsed, false);
    assert.equal('viewCount' in parsed, false);
  });
});

describe('密码哈希', () => {
  it('同一密码两次哈希不同（加了随机盐）', () => {
    const a = hashPassword('admin123');
    const b = hashPassword('admin123');
    assert.notEqual(a, b);
    assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it('能验证正确密码、拒绝错误密码', () => {
    const stored = hashPassword('admin123');
    assert.equal(verifyPassword('admin123', stored), true);
    assert.equal(verifyPassword('admin124', stored), false);
  });

  it('空值 / 损坏的哈希不会通过', () => {
    assert.equal(verifyPassword('admin123', null), false);
    assert.equal(verifyPassword('admin123', ''), false);
    assert.equal(verifyPassword('admin123', 'plaintext'), false);
    assert.equal(verifyPassword('admin123', 'md5$abc$def'), false);
  });
});

describe('工具调用参数解析', () => {
  it('解析合法 JSON 对象', () => {
    assert.deepEqual(safeParse('{"a":1}'), { a: 1 });
  });

  it('非法 JSON / 非对象都退化成空对象，不抛异常', () => {
    assert.deepEqual(safeParse(''), {});
    assert.deepEqual(safeParse('{坏了'), {});
    assert.deepEqual(safeParse('123'), {});
    assert.deepEqual(safeParse('null'), {});
  });
});

describe('生产环境密钥体检', () => {
  const silent = { error: () => {} };
  const placeholders = ['', 'change-me-in-production-please'];

  function withSecret(secret: string | undefined, isProduction: boolean) {
    const original = process.env.JWT_SECRET;
    if (secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secret;
    const exits: number[] = [];
    const originalExit = process.exit;
    // assertProductionSecrets 用 process.exit(1) 拒绝启动，这里拦下来只记录
    process.exit = ((code?: number) => { exits.push(code ?? 0); return undefined as never; }) as typeof process.exit;
    try {
      assertProductionSecrets(isProduction, placeholders, silent);
    } finally {
      process.exit = originalExit;
      if (original === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = original;
    }
    return exits;
  }

  it('开发环境不做检查', () => {
    assert.deepEqual(withSecret('', false), []);
  });

  it('生产环境用占位密钥直接拒绝启动', () => {
    assert.deepEqual(withSecret('change-me-in-production-please', true), [1]);
    assert.deepEqual(withSecret(undefined, true), [1]);
  });

  it('生产环境密钥太短也拒绝启动', () => {
    assert.deepEqual(withSecret('short', true), [1]);
  });

  it('生产环境给了足够长的真密钥就放行', () => {
    assert.deepEqual(withSecret('a'.repeat(32), true), []);
  });
});
