import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RerankService } from './rerank.service.js';

/**
 * RerankService 的行为测试。
 *
 * 为什么用真 HTTP 服务而不是 mock fetch：
 * 这个类的**全部价值就在于失败时的降级行为**（超时、5xx、格式不对都要能优雅跳过），
 * mock 掉 fetch 就把最该测的部分测没了。起一个本地 server 成本很低，测的是真实链路。
 */

type Handler = (body: unknown) => { status: number; body: unknown } | 'hang';

function startServer(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body: unknown = null;
        try { body = JSON.parse(raw); } catch { /* 空体也允许 */ }
        const out = handler(body);
        if (out === 'hang') return; // 不响应，用于测超时
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.body));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: 'http://127.0.0.1:' + port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** 只用到 current.rerankBaseUrl，其余字段给个空壳即可 */
function makeService(baseUrl: string) {
  const recorded: unknown[] = [];
  const config = { current: { rerankBaseUrl: baseUrl } };
  const usage = { record: async (x: unknown) => { recorded.push(x); } };
  const service = new RerankService(config as never, usage as never);
  return { service, recorded };
}

const candidates = [
  { id: '1', text: '优惠券不可叠加', score: 0.9 },
  { id: '2', text: '配送费满 19 元免', score: 0.8 },
  { id: '3', text: '退款政策 7 天无理由', score: 0.7 },
];

test('未配置地址时不启用，直接返回 null（调用方沿用原序）', async () => {
  const { service } = makeService('');
  assert.equal(service.enabled, false);
  assert.equal(await service.rerank('退款', candidates, 2), null);
});

test('候选数不超过 topK 时不发请求（没有可重排的余地）', async () => {
  let called = 0;
  const srv = await startServer(() => { called += 1; return { status: 200, body: { results: [] } }; });
  try {
    const { service } = makeService(srv.url);
    assert.equal(await service.rerank('退款', candidates.slice(0, 2), 2), null);
    assert.equal(called, 0, '不该发请求');
  } finally { await srv.close(); }
});

test('空查询不发请求', async () => {
  let called = 0;
  const srv = await startServer(() => { called += 1; return { status: 200, body: { results: [] } }; });
  try {
    const { service } = makeService(srv.url);
    assert.equal(await service.rerank('   ', candidates, 1), null);
    assert.equal(called, 0);
  } finally { await srv.close(); }
});

test('正常重排：按服务返回的顺序重排候选', async () => {
  const srv = await startServer((body) => {
    const docs = (body as { documents: { id: string }[] }).documents;
    // 故意倒序返回，验证调用方确实按返回顺序重排了
    return { status: 200, body: { results: docs.map((d) => ({ id: d.id, score: 1 })).reverse() } };
  });
  try {
    const { service, recorded } = makeService(srv.url);
    const out = await service.rerank('退款', candidates, 2);
    assert.ok(out);
    assert.deepEqual(out.map((c) => c.id), ['3', '2']);
    assert.equal(recorded.length, 1, '重排应记一笔用量，后台才看得到调用次数');
    assert.equal((recorded[0] as { kind: string }).kind, 'rerank');
  } finally { await srv.close(); }
});

test('服务返回 5xx → 返回 null 并记录失败原因', async () => {
  const srv = await startServer(() => ({ status: 500, body: { error: 'boom' } }));
  try {
    const { service } = makeService(srv.url);
    assert.equal(await service.rerank('退款', candidates, 2), null);
    const h = service.health();
    assert.equal(h.failing, true);
    assert.match(String(h.lastError), /500/);
    assert.ok(h.hint, '应给出「跳过重排不影响可用性」的提示');
  } finally { await srv.close(); }
});

test('返回格式不对（没有 results 数组）→ 返回 null', async () => {
  const srv = await startServer(() => ({ status: 200, body: { unexpected: true } }));
  try {
    const { service } = makeService(srv.url);
    assert.equal(await service.rerank('退款', candidates, 2), null);
    assert.equal(service.health().failing, true);
  } finally { await srv.close(); }
});

test('返回的 id 全部不认识（结果为空）→ 返回 null 而不是返回空数组', async () => {
  const srv = await startServer(() => ({ status: 200, body: { results: [{ id: 'nope', score: 1 }] } }));
  try {
    const { service } = makeService(srv.url);
    // 返回空数组会让调用方以为「重排后一条都不该要」，从而把结果清空 —— 必须返回 null
    assert.equal(await service.rerank('退款', candidates, 2), null);
  } finally { await srv.close(); }
});

test('服务不响应 → 超时后返回 null，不挂住主流程', async () => {
  const srv = await startServer(() => 'hang');
  try {
    const { service } = makeService(srv.url);
    const started = Date.now();
    assert.equal(await service.rerank('退款', candidates, 2), null);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 1000, '应等满超时时间，实际 ' + elapsed + 'ms');
    assert.ok(elapsed < 4000, '不该无限等，实际 ' + elapsed + 'ms');
    assert.match(String(service.health().lastError), /超时/);
  } finally { await srv.close(); }
});

test('地址不可达 → 返回 null', async () => {
  // 指向一个几乎不可能占用的端口
  const { service } = makeService('http://127.0.0.1:9');
  assert.equal(await service.rerank('退款', candidates, 2), null);
  assert.equal(service.health().failing, true);
});

test('成功后失败状态被清掉（health 不会一直报错）', async () => {
  let fail = true;
  const srv = await startServer((body) => {
    if (fail) return { status: 500, body: {} };
    const docs = (body as { documents: { id: string }[] }).documents;
    return { status: 200, body: { results: docs.map((d) => ({ id: d.id, score: 1 })) } };
  });
  try {
    const { service } = makeService(srv.url);
    await service.rerank('退款', candidates, 2);
    assert.equal(service.health().failing, true);
    fail = false;
    await service.rerank('退款', candidates, 2);
    assert.equal(service.health().failing, false, '恢复后不应再报失败');
    assert.ok(service.health().lastSuccessAt);
  } finally { await srv.close(); }
});
