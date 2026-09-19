import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { products } from '../../db/schema/index.js';
import { LlmService } from './llm.service.js';

export interface CopywritingResult {
  productId: number;
  productTitle: string;
  title: string;
  subtitle: string;
  sellingPoints: string[];
  description: string;
  tags: string[];
  style: string;
  model: string;
}

const STYLE_HINT: Record<string, string> = {
  student: '面向大学生，口语化、有同学之间的玩笑感，但不要浮夸',
  professional: '正式、克制、突出参数与性价比',
  playful: '活泼、有网感，适合社交平台传播',
};

/**
 * 商品文案生成。
 * 有模型时让模型写；没有模型时用商品真实属性拼一版可用的模板文案 —— 不编造不存在的卖点。
 */
@Injectable()
export class CopywritingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
  ) {}

  async generate(productId: number, style = 'student'): Promise<CopywritingResult> {
    const product = (await this.db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!product) throw new NotFoundException('商品不存在');

    if (this.llm.current.isMock) return this.template(product, style);

    const facts = [
      '商品名：' + product.title,
      '品类：' + (product.kind === 'book' ? '二手书' : '零食'),
      product.flavor ? '口味：' + product.flavor : '',
      product.spicyLevel ? '辣度：' + product.spicyLevel + '/5' : '',
      product.spec ? '规格：' + product.spec : '',
      product.condition ? '成色：' + product.condition : '',
      product.hasNotes !== null ? (product.hasNotes ? '含笔记' : '无笔记') : '',
      product.course ? '适用课程：' + product.course : '',
      '价格：¥' + (product.priceCents / 100).toFixed(2),
      '标签：' + (product.tags ?? []).join('、'),
      '已售：' + product.sales + ' 件',
    ].filter(Boolean).join('\n');

    const prompt = [
      '你是「AI优选零食」的商品运营。根据下面这些**真实属性**写商品文案，不许编造不存在的卖点或夸大功效。',
      facts,
      '风格要求：' + (STYLE_HINT[style] ?? STYLE_HINT.student),
      '只输出 JSON：{"title":"不超过 24 字","subtitle":"不超过 20 字","sellingPoints":["3 条，每条不超过 15 字"],"description":"不超过 120 字","tags":["最多 5 个"]}',
    ].join('\n');

    try {
      const result = await this.llm.current.chat([{ role: 'user', content: prompt }], []);
      const text = result.content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Partial<CopywritingResult>;
      return {
        productId,
        productTitle: product.title,
        title: String(parsed.title ?? product.title).slice(0, 40),
        subtitle: String(parsed.subtitle ?? product.subtitle ?? ''),
        sellingPoints: (parsed.sellingPoints ?? []).slice(0, 4).map(String),
        description: String(parsed.description ?? product.description ?? ''),
        tags: (parsed.tags ?? product.tags ?? []).slice(0, 6).map(String),
        style,
        model: this.llm.current.model,
      };
    } catch {
      return this.template(product, style);
    }
  }

  /** 无模型时的模板：卖点全部来自商品真实字段 */
  private template(product: typeof products.$inferSelect, style: string): CopywritingResult {
    const points: string[] = [];
    const isBook = product.kind === 'book';

    if (isBook) {
      if (product.condition === 'like_new') points.push('九成新，几乎没翻过');
      else if (product.condition === 'good') points.push('七成新，少量标注不影响看');
      else if (product.condition === 'fair') points.push('五成新，价格直接打下来');
      if (product.hasNotes) points.push('学长学姐手写笔记还在');
      if (product.course) points.push(product.course + ' 课程指定用书');
      if (product.originalPriceCents > product.priceCents) {
        const off = Math.round((1 - product.priceCents / product.originalPriceCents) * 10) / 10;
        points.push('比新书省 ' + Math.round((1 - product.priceCents / product.originalPriceCents) * 100) + '%（约 ' + off.toFixed(1) + ' 折）');
      }
    } else {
      if (product.spicyLevel && product.spicyLevel >= 4) points.push('辣度 ' + product.spicyLevel + '/5，重口党狂喜');
      if (product.spicyLevel !== null && product.spicyLevel <= 1) points.push('不辣，怕辣的同学也能吃');
      if (product.flavor) points.push(product.flavor + '口味');
      if (product.spec) points.push(product.spec + '，宿舍囤货刚好');
      if (product.sales >= 150) points.push('已售 ' + product.sales + ' 件，回头客多');
    }
    if (product.priceCents <= 500) points.push('不到 5 块钱，随手就能买');

    const sellingPoints = points.slice(0, 3);
    const titleSuffix = isBook ? '· 校园二手教材' : '· 宿舍必备零食';
    const description = isBook
      ? product.title + '，' + (product.publisher ?? '') + ' ' + (product.edition ?? '') + '。' +
        (product.hasNotes ? '书内有重点标注和笔记，复习时能直接对照。' : '书页干净，没有涂写。') +
        '支持当面验书，不满意可以不收。现价 ¥' + (product.priceCents / 100).toFixed(2) + '。'
      : product.title + '，' + (product.subtitle ?? '') + '。' +
        (product.shelfLifeDays ? '保质期 ' + product.shelfLifeDays + ' 天，' : '') +
        '下单后 30 分钟内送到宿舍楼下自提柜。现价 ¥' + (product.priceCents / 100).toFixed(2) + '。';

    return {
      productId: product.id,
      productTitle: product.title,
      title: (product.title + ' ' + titleSuffix).slice(0, 40),
      subtitle: sellingPoints[0] ?? (product.subtitle ?? ''),
      sellingPoints,
      description,
      tags: [...new Set([...(product.tags ?? []), isBook ? '校园二手' : '宿舍零食'])].slice(0, 6),
      style,
      model: 'template',
    };
  }
}