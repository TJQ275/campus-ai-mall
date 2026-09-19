import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { and, eq, or, sql } from 'drizzle-orm';
import { DB } from '../../database/database.module.js';
import type { Db } from '../../../db/client.js';
import { aiKnowledge } from '../../../db/schema/index.js';
import { EmbeddingService } from '../embedding.service.js';
import { RerankService } from '../rerank.service.js';

/** 召回条数：放宽一点，让重排有得选 */
const RECALL_LIMIT = 20;
/** 最终喂给模型的条数：太多会稀释注意力，也会撑大 prompt */
const FINAL_LIMIT = 4;
import type { AiTool, ToolResult } from './tool.types.js';

/** 从问句切检索词：中文按 2 字滑窗，英文数字按词 */
/**
 * 口语同义词表：用户怎么说 ↔ 知识库正文怎么写。
 *
 * 为什么需要：关键词检索是**字面匹配**，而中文口语和书面语经常一个字都对不上。
 * 评测里 pol-16「满多少免运费」就是典型 —— 用户说「运费」，
 * 知识库写的是「满 19 元免配送费」，5 个检索词一个都没命中，
 * 结果模型回答「知识库里暂时没检索到免运费的条款」，而答案其实就在库里。
 *
 * 语义检索（配了 embedding 模型）自己能处理同义；但这张表在**零 Key 演示模式**下是唯一的指望，
 * 因为那种模式根本没有向量检索。所以词表要小而准，不要贪多 —— 加错词会让检索跑偏。
 */
const SYNONYMS: Record<string, string[]> = {
  // 物流
  运费: ['配送费'],
  邮费: ['配送费'],
  免运: ['免配送费', '配送费'],
  自取: ['自提'],
  几天: ['时效', '30 分钟'],
  多久: ['时效'],
  // 售后
  退货: ['退款'],
  退还: ['退款'],
  到帐: ['到账'],
  钱: ['余额'],
  // 二手书
  新旧: ['成色'],
  品相: ['成色'],
  折旧: ['成色'],
  // 优惠
  打折: ['优惠券'],
  满减: ['优惠券'],
};

/** 把检索词按同义词表扩展（去重，且不打乱原有顺序） */
export function expandSynonyms(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const token of tokens) {
    for (const extra of SYNONYMS[token] ?? []) out.add(extra);
  }
  return [...out];
}

export function tokenize(text: string): string[] {
  const cleaned = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ').trim();
  const tokens = new Set<string>();
  for (const word of cleaned.split(' ')) {
    if (!word) continue;
    if (/^[a-zA-Z0-9]+$/.test(word)) {
      if (word.length >= 2) tokens.add(word);
      continue;
    }
    if (word.length <= 3) tokens.add(word);
    for (let i = 0; i + 2 <= word.length; i += 1) tokens.add(word.slice(i, i + 2));
  }
  return [...tokens].slice(0, 12);
}

/**
 * 知识库检索（客服 RAG 的检索段）。
 * 有 embedding 模型走向量检索，没有则自动退回关键词检索，两条路返回同样结构，
 * 所以模型侧的「引用来源」行为在两种模式下完全一致。
 */
@Injectable()
export class KnowledgeTools {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly embedding: EmbeddingService,
    private readonly rerank: RerankService,
  ) {}

  all(): AiTool[] {
    return [this.searchKnowledge()];
  }

  private searchKnowledge(): AiTool {
    return {
      name: 'search_knowledge',
      label: '正在查询平台规则',
      description:
        '检索平台知识库：退款政策、退款到账时效、二手书成色定义、配送与自提、教材回收、优惠券规则等。回答任何政策类问题前必须先调用，并在回复里引用返回的 source 标题。',
      schema: z.object({
        query: z.string().min(2).describe('检索问句，直接用用户的原话即可'),
      }),
      run: async (_ctx, args): Promise<ToolResult> => {
        const query = String(args.query ?? '');
        // 先【广召回】再【重排】：直接召回 4 条就交给模型，最相关的那条可能排在第 7 位，
        // 根本没进候选。所以这里把召回放宽到 20 条，再由重排服务精选出 4 条。
        const vectorRows = await this.embedding.searchKnowledgeByVector(query, RECALL_LIMIT);
        let rows: { id: number; title: string; source: string | null; content: string; score?: number }[] = vectorRows ?? [];
        let mode = 'vector';

        if (!rows.length) {
          mode = 'keyword';
          // 先按分词结果扩展同义词，再做字面匹配
          const tokens = expandSynonyms(tokenize(query));
          const conditions = tokens.map((token) => {
            const like = '%' + token + '%';
            return or(sql`${aiKnowledge.title} ilike ${like}`, sql`${aiKnowledge.content} ilike ${like}`);
          });
          const valid = conditions.filter((c): c is NonNullable<typeof c> => Boolean(c));
          // 先按 OR 粗召回，再在应用层按「命中词数」打分：标题命中权重 3，正文命中权重 1
          const matched = valid.length
            ? await this.db
                .select({ id: aiKnowledge.id, title: aiKnowledge.title, source: aiKnowledge.source, content: aiKnowledge.content })
                .from(aiKnowledge)
                .where(and(eq(aiKnowledge.enabled, true), or(...valid)))
                .limit(20)
            : [];
          rows = matched
            .map((r) => {
              let score = 0;
              for (const token of tokens) {
                if (r.title.includes(token)) score += 3;
                if (r.content.includes(token)) score += 1;
              }
              return { ...r, score };
            })
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score)
            // 关键词路径也保留完整召回集，交给同一套重排逻辑精选
            .slice(0, RECALL_LIMIT);
        }

        // 重排：把 20 条候选重新排序取前 4。服务不可用时返回 null，此时沿用召回顺序，
        // 并在 brief 里体现出来 —— 检索质量降级了，模型和日志都该看得见。
        if (rows.length > FINAL_LIMIT) {
          const reranked = await this.rerank.rerank(
            query,
            rows.map((r) => ({ id: String(r.id), text: r.title + ' ' + r.content, score: r.score })),
            FINAL_LIMIT,
          );
          if (reranked) {
            const byId = new Map(rows.map((r) => [String(r.id), r]));
            const picked = reranked.map((x) => byId.get(x.id)).filter((r): r is (typeof rows)[number] => Boolean(r));
            if (picked.length) {
              rows = picked;
              mode = mode + '+rerank';
            }
          } else {
            rows = rows.slice(0, FINAL_LIMIT);
          }
        }

        if (!rows.length) {
          return {
            brief: '知识库里没有查到相关条款',
            data: { chunks: [], hint: '没有匹配到政策条款，建议告诉用户可以直接转人工客服，或帮忙留一条工单。' },
          };
        }

        const chunks = rows.map((r) => ({
          title: r.title,
          source: r.source,
          content: r.content,
          score: typeof r.score === 'number' ? Number(r.score.toFixed(3)) : undefined,
        }));

        return {
          brief:
            '命中 ' + chunks.length + ' 条条款（' + (mode === 'vector' ? '语义检索' : '关键词检索') + '）：' + chunks.map((c) => c.title).join('、'),
          data: {
            mode,
            chunks,
            citationRule: '回答时用「根据《标题》」的形式引用条款，不要编造上面没出现的政策。',
          },
        };
      },
    };
  }
}
