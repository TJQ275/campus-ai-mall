import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { DB } from '../../database/database.module.js';
import type { Db } from '../../../db/client.js';
import { products } from '../../../db/schema/index.js';
import { CatalogService, type ProductCard } from '../../catalog/catalog.service.js';
import { LlmService } from '../llm.service.js';
import { EmbeddingService } from '../embedding.service.js';
import type { AiTool, ToolResult } from './tool.types.js';

const yuan = (cents: number) => '¥' + (cents / 100).toFixed(2);

const toCard = (p: typeof products.$inferSelect): ProductCard => ({
  id: p.id, kind: p.kind, title: p.title, subtitle: p.subtitle, cover: p.cover,
  priceCents: p.priceCents, originalPriceCents: p.originalPriceCents,
  sales: p.sales, stock: p.stock, tags: p.tags ?? [], ratingAvg: p.ratingAvg,
});

/**
 * 找书找同款：扫码（ISBN，零依赖可用）+ 拍照（需要视觉模型）。
 * 拍照这条路即使没有视觉模型也不会「假装成功」—— 它会明确告诉模型改问用户要描述或让用户扫码。
 */
@Injectable()
export class MediaTools {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
  ) {}

  all(): AiTool[] {
    return [this.searchByIsbn(), this.searchByImage()];
  }

  private searchByIsbn(): AiTool {
    return {
      name: 'search_by_isbn',
      label: '正在按 ISBN 找书',
      description:
        '用 ISBN 条码查在售二手书。用户扫描书背条码、或直接报出 ISBN 时使用。支持带横杠的写法。',
      schema: z.object({
        isbn: z.string().min(10).max(20).describe('ISBN，可带横杠或空格'),
      }),
      run: async (_ctx, args): Promise<ToolResult> => {
        const isbn = String(args.isbn).replace(/[^0-9Xx]/g, '').toUpperCase();
        const rows = await this.db.select().from(products).where(eq(products.isbn, isbn)).limit(5);
        if (!rows.length) {
          return {
            brief: '没有找到 ISBN ' + isbn + ' 的在售二手书',
            data: { isbn, found: 0, hint: '平台暂时没有这本书，可以告诉用户点「求购」登记，到货后通知。' },
          };
        }
        return {
          brief: '找到 ' + rows.length + ' 本：' + rows.map((r) => r.title + ' ' + yuan(r.priceCents)).join('、'),
          cards: rows.map(toCard),
          data: { isbn, found: rows.length, items: rows.map((r) => ({ productId: r.id, title: r.title, price: yuan(r.priceCents), condition: r.condition, stock: r.stock })) },
        };
      },
    };
  }

  private searchByImage(): AiTool {
    return {
      name: 'search_by_image',
      label: '正在识别图片找同款',
      description:
        '拍照或上传图片找同款商品（零食包装、教材封面）。用户发了图片、或描述「拍了一张 xxx 的照片」时使用。若用户提供了文字描述，也可以直接传 description。',
      schema: z.object({
        imageUrl: z.string().optional().describe('用户上传图片的地址，通常是 /uploads/... 开头'),
        description: z.string().optional().describe('用户对图片的文字描述，例如「红色包装的辣条」'),
      }),
      run: async (_ctx, args): Promise<ToolResult> => {
        const imageUrl = args.imageUrl as string | undefined;
        let description = (args.description as string | undefined) ?? '';
        let method = 'description';

        if (!description && imageUrl) {
          const described = await this.llm.describeImage(imageUrl);
          if (described) {
            description = [described.title, ...described.keywords].filter(Boolean).join(' ');
            method = 'vision';
          }
        }

        if (!description) {
          return {
            brief: '暂时无法识别图片',
            data: {
              needsDescription: true,
              hint: '当前没有配置视觉模型。请让用户用一句话描述图片里的东西（例如「红色包装的辣条」），或者如果是教材，直接扫书背面的 ISBN 条码更快更准。',
            },
          };
        }

        // 有向量就走语义检索，否则退回关键词
        const vectorRows = await this.embedding.searchProductsByVector(description, 5);
        if (vectorRows?.length) {
          const ids = vectorRows.map((r) => r.id);
          const list = await this.db.select().from(products).where(eq(products.status, 'on'));
          const byId = new Map(list.map((p) => [p.id, p]));
          const rows = ids.map((id) => byId.get(id)).filter((p): p is typeof products.$inferSelect => Boolean(p));
          if (rows.length) {
            return {
              brief: '按图片语义找到 ' + rows.length + ' 件相似商品',
              cards: rows.map(toCard),
              data: { method: method + '+vector', query: description, items: rows.map((p) => ({ productId: p.id, title: p.title, price: yuan(p.priceCents) })) },
            };
          }
        }

        const keyword = description.split(/\s+/)[0] ?? description;
        const result = await this.catalog.search({ keyword, pageSize: 5 });
        return {
          brief: result.total ? '按关键词「' + keyword + '」找到 ' + result.total + ' 件商品' : '没有找到相似商品',
          cards: result.list,
          data: { method, query: description, keyword, total: result.total, items: result.list.map((p) => ({ productId: p.id, title: p.title, price: yuan(p.priceCents) })) },
        };
      },
    };
  }
}
