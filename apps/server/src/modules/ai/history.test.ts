import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryMessages, type HistoryRow } from './history.js';

/**
 * 历史消息重建是「AI 会不会编造商品」的关键一环：
 * 工具结果必须以 tool 角色回灌，不能伪装成助手自己的发言。
 */

const row = (patch: Partial<HistoryRow> & { id: number; role: string }): HistoryRow => ({
  contentType: 'text',
  content: '',
  toolName: null,
  ...patch,
});

describe('buildHistoryMessages', () => {
  it('把工具结果还原成 assistant(tool_calls) + tool 配对', () => {
    const rows: HistoryRow[] = [
      row({ id: 1, role: 'user', content: '想吃辣的' }),
      row({
        id: 2,
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([{ id: 'call_a', name: 'search_products', arguments: { keyword: '辣' } }]),
      }),
      row({ id: 3, role: 'tool', toolName: 'search_products', toolCallId: 'call_a', content: '{"total":2}' }),
    ];

    const messages = buildHistoryMessages(rows);

    assert.equal(messages.length, 3);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].tool_calls?.[0].name, 'search_products');
    assert.equal(messages[1].tool_calls?.[0].id, 'call_a');
    // 关键断言：工具结果的角色必须是 tool，不能是 assistant
    assert.equal(messages[2].role, 'tool');
    assert.equal(messages[2].tool_call_id, 'call_a');
    assert.equal(messages[2].name, 'search_products');
  });

  it('没有 id 的老数据按顺序配对', () => {
    const rows: HistoryRow[] = [
      row({
        id: 10,
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([{ name: 'get_cart', arguments: {} }, { name: 'get_my_orders', arguments: {} }]),
      }),
      row({ id: 11, role: 'tool', toolName: 'get_cart', content: '{"totalCount":2}' }),
      row({ id: 12, role: 'tool', toolName: 'get_my_orders', content: '{"orders":[]}' }),
    ];

    const messages = buildHistoryMessages(rows);

    assert.equal(messages.length, 3);
    assert.equal(messages[1].tool_call_id, messages[0].tool_calls?.[0].id);
    assert.equal(messages[2].tool_call_id, messages[0].tool_calls?.[1].id);
    assert.notEqual(messages[1].tool_call_id, messages[2].tool_call_id);
  });

  it('tool_call_id 与 args 不匹配时以 id 为准', () => {
    const rows: HistoryRow[] = [
      row({
        id: 20,
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([
          { id: 'call_x', name: 'search_products', arguments: {} },
          { id: 'call_y', name: 'get_cart', arguments: {} },
        ]),
      }),
      // 顺序被反转：id 配对应该仍然正确
      row({ id: 21, role: 'tool', toolName: 'get_cart', toolCallId: 'call_y', content: '{}' }),
      row({ id: 22, role: 'tool', toolName: 'search_products', toolCallId: 'call_x', content: '{}' }),
    ];

    const messages = buildHistoryMessages(rows);
    const [assistant, first, second] = messages;

    assert.equal(first.tool_call_id, 'call_y');
    assert.equal(second.tool_call_id, 'call_x');
    assert.deepEqual(assistant.tool_calls?.map((c) => c.id), ['call_x', 'call_y']);
  });

  it('孤立的工具结果不伪装成助手发言', () => {
    const rows: HistoryRow[] = [row({ id: 30, role: 'tool', toolName: 'search_products', content: '{"a":1}' })];

    const messages = buildHistoryMessages(rows);

    assert.equal(messages.length, 1);
    assert.notEqual(messages[0].role, 'assistant');
    assert.match(messages[0].content, /历史工具 search_products/);
  });

  it('工具结果超长时截断，避免 prompt 膨胀', () => {
    const rows: HistoryRow[] = [
      row({
        id: 40,
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([{ id: 'call_big', name: 'search_products', arguments: {} }]),
      }),
      row({ id: 41, role: 'tool', toolName: 'search_products', toolCallId: 'call_big', content: 'x'.repeat(5000) }),
    ];

    const messages = buildHistoryMessages(rows);

    assert.equal(messages[1].content.length, 1500);
  });

  it('保留助手展示过的商品标记（否则模型不知道卡片还在屏幕上）', () => {
    const rows: HistoryRow[] = [
      row({ id: 50, role: 'assistant', content: '给你挑了 2 件', cards: [{ id: 7, title: '辣条' }, { id: 8, title: '薯片' }] }),
    ];

    const messages = buildHistoryMessages(rows);

    assert.match(messages[0].content, /已展示商品: 7:辣条 \| 8:薯片/);
  });

  it('没有调用明细的空轮次直接丢弃', () => {
    const rows: HistoryRow[] = [
      row({ id: 60, role: 'user', content: '你好' }),
      row({ id: 61, role: 'assistant', contentType: 'tool_calls', content: '[]' }),
      row({ id: 62, role: 'assistant', content: '在的' }),
    ];

    const messages = buildHistoryMessages(rows);

    assert.equal(messages.length, 2);
    assert.equal(messages[1].content, '在的');
  });

  it('损坏的 JSON 不会抛异常', () => {
    const rows: HistoryRow[] = [
      row({ id: 70, role: 'assistant', contentType: 'tool_calls', content: '{不是合法 JSON' }),
      row({ id: 71, role: 'user', content: '继续' }),
    ];

    const messages = buildHistoryMessages(rows);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, '继续');
  });

  it('保持时间顺序', () => {
    const rows: HistoryRow[] = [
      row({ id: 80, role: 'user', content: '第一句' }),
      row({
        id: 81,
        role: 'assistant',
        contentType: 'tool_calls',
        content: JSON.stringify([{ id: 'c1', name: 'get_cart', arguments: {} }]),
      }),
      row({ id: 82, role: 'tool', toolName: 'get_cart', toolCallId: 'c1', content: '{}' }),
      row({ id: 83, role: 'assistant', content: '购物车是空的' }),
      row({ id: 84, role: 'user', content: '第二句' }),
    ];

    const messages = buildHistoryMessages(rows);

    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'assistant', 'tool', 'assistant', 'user'],
    );
    assert.equal(messages[4].content, '第二句');
  });
});
