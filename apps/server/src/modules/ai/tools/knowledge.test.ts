import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSynonyms, tokenize } from './knowledge.tools.js';

test('分词：中文按 2 字滑窗，英文数字按整词', () => {
  const t = tokenize('满多少免运费');
  assert.ok(t.includes('运费'));
  assert.ok(t.includes('免运'));
  const e = tokenize('iPhone 15 多少钱');
  // 分词保留原始大小写（'iPhone' 而不是 'iphone'）——
  // 大小写不敏感是由 SQL 的 ilike 负责的，分词这层不做归一化。
  assert.ok(e.includes('iPhone'));
  assert.ok(e.includes('15'));
  assert.ok(e.includes('多少'));
});

test('同义词扩展：口语能对上知识库的书面写法', () => {
  // 这是评测 pol-16 暴露的真实漏检：用户说「运费」，库里写的是「配送费」
  const tokens = expandSynonyms(tokenize('满多少免运费'));
  assert.ok(tokens.includes('配送费'), '「运费」应扩展出「配送费」');
});

test('同义词扩展：不改变原有词、且不重复', () => {
  const base = tokenize('怎么退款');
  const expanded = expandSynonyms(base);
  for (const t of base) assert.ok(expanded.includes(t), '原有词不能丢');
  assert.equal(new Set(expanded).size, expanded.length, '不能有重复');
});

test('同义词扩展：没有映射时原样返回', () => {
  const base = ['高等数学', '教材'];
  assert.deepEqual(expandSynonyms(base), base);
});

test('同义词扩展：多个映射可以叠加', () => {
  const expanded = expandSynonyms(['多久', '运费']);
  assert.ok(expanded.includes('时效'));
  assert.ok(expanded.includes('配送费'));
});
