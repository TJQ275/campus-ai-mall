import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { categories, productImages, productSkus, products, reviewSummaries, userBehaviors } from '../../db/schema/index.js';

export interface SearchParams {
  keyword?: string;
  kind?: 'snack' | 'book';
  categoryId?: number;
  /** 元 */
  priceMin?: number;
  priceMax?: number;
  tags?: string[];
  condition?: 'new' | 'like_new' | 'good' | 'fair';
  course?: string;
  isbn?: string;
  sort?: 'default' | 'sales' | 'price_asc' | 'price_desc' | 'newest';
  page?: number;
  pageSize?: number;
}

export interface ProductCard {
  id: number;
  kind: string;
  title: string;
  subtitle: string | null;
  cover: string | null;
  priceCents: number;
  originalPriceCents: number;
  sales: number;
  stock: number;
  tags: string[];
  ratingAvg: number;
  /** 给 AI 与前台共用的推荐理由占位，P3 由个性化模块填充 */
  reason?: string;
}

const toCents = (yuan?: number) => (yuan === undefined ? undefined : Math.round(yuan * 100));

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Db) {}

  listCategories(kind?: 'snack' | 'book') {
    const where = kind ? and(eq(categories.enabled, true), eq(categories.kind, kind)) : eq(categories.enabled, true);
    return this.db.select().from(categories).where(where).orderBy(asc(categories.kind), asc(categories.sort));
  }

  /**
   * 商品检索 —— 前台搜索与 AI 工具 search_products 共用这一条路径。
   * 关键词走 ILIKE，标签走 jsonb 包含，其余是结构化过滤；向量语义检索在 P3 接入。
   */
  async search(params: SearchParams) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 10));
    const conditions: SQL[] = [eq(products.status, 'on')];

    if (params.kind) conditions.push(eq(products.kind, params.kind));
    if (params.categoryId) conditions.push(eq(products.categoryId, params.categoryId));
    if (params.keyword) {
      const like = '%' + params.keyword + '%';
      const keywordCondition = or(
        ilike(products.title, like),
        ilike(products.subtitle, like),
        ilike(products.course, like),
        ilike(products.author, like),
        sql`${products.tags}::text ilike ${like}`,
      );
      if (keywordCondition) conditions.push(keywordCondition);
    }
    const min = toCents(params.priceMin);
    const max = toCents(params.priceMax);
    if (min !== undefined) conditions.push(gte(products.priceCents, min));
    if (max !== undefined) conditions.push(lte(products.priceCents, max));
    if (params.condition) conditions.push(eq(products.condition, params.condition));
    if (params.course) conditions.push(ilike(products.course, '%' + params.course + '%'));
    if (params.isbn) conditions.push(eq(products.isbn, params.isbn));
    // 标签采用「任一命中」：用户说「想吃辣的、熬夜续命」时不该要求商品同时具备两个标签。
    // 注意必须用 ARRAY[...] 展开成独立参数，直接把 JS 数组当参数会被渲染成 ($1, $2) 行构造器。
    if (params.tags?.length) {
      const list = sql.join(params.tags.map((tag) => sql`${tag}`), sql`, `);
      conditions.push(sql`${products.tags} ?| ARRAY[${list}]::text[]`);
    }

    const where = and(...conditions);
    const orderBy =
      params.sort === 'price_asc' ? [asc(products.priceCents)]
      : params.sort === 'price_desc' ? [desc(products.priceCents)]
      : params.sort === 'newest' ? [desc(products.createdAt)]
      : params.sort === 'sales' ? [desc(products.sales)]
      : [desc(products.sales), desc(products.ratingAvg)];

    const list = await this.db.select().from(products).where(where).orderBy(...orderBy).limit(pageSize).offset((page - 1) * pageSize);
    const counted = await this.db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);

    return {
      list: list.map((p) => this.toCard(p)),
      total: counted[0]?.total ?? 0,
      page,
      pageSize,
    };
  }

  private toCard(p: typeof products.$inferSelect): ProductCard {
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      subtitle: p.subtitle,
      cover: p.cover,
      priceCents: p.priceCents,
      originalPriceCents: p.originalPriceCents,
      sales: p.sales,
      stock: p.stock,
      tags: p.tags ?? [],
      ratingAvg: p.ratingAvg,
    };
  }

  async detail(id: number, viewerId?: number) {
    const found = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    const product = found[0];
    if (!product) throw new NotFoundException('商品不存在或已下架');

    const [skus, images, summary] = await Promise.all([
      this.db.select().from(productSkus).where(and(eq(productSkus.productId, id), eq(productSkus.enabled, true))),
      this.db.select().from(productImages).where(eq(productImages.productId, id)),
      this.db.select().from(reviewSummaries).where(eq(reviewSummaries.productId, id)).limit(1),
    ]);

    // 浏览量 + 行为埋点（推荐算法与画像的原料），失败不影响主流程
    void this.db.update(products).set({ viewCount: product.viewCount + 1 }).where(eq(products.id, id)).catch(() => undefined);
    if (viewerId) {
      void this.db.insert(userBehaviors).values({ userId: viewerId, productId: id, type: 'view' }).catch(() => undefined);
    }

    return { ...product, skus, images: images.length ? images : (product.images ?? []), reviewSummary: summary[0] ?? null };
  }

  /** 首页聚合：Banner + 分类 + 热销 + 推荐（UserCF 在 P3 替换这里的兜底逻辑） */
  async home(kind?: 'snack' | 'book', userId?: number) {
    const [categoryList, hot, fresh] = await Promise.all([
      this.listCategories(kind),
      this.search({ kind, sort: 'sales', pageSize: 6 }),
      this.search({ kind, sort: 'newest', pageSize: 6 }),
    ]);
    return {
      banners: [
        { id: 1, title: '开学季 · 零食满 19 元免配送', image: 'https://picsum.photos/seed/banner1/750/300', link: '/pages/category/index?kind=snack' },
        { id: 2, title: '二手教材 · 低至三折', image: 'https://picsum.photos/seed/banner2/750/300', link: '/pages/category/index?kind=book' },
      ],
      categories: categoryList,
      hot: hot.list,
      recommend: fresh.list,
      /** 推荐策略说明：有行为数据时由 P3 的 UserCF 接管 */
      recommendStrategy: userId ? 'hot-fallback(user-behavior-pending)' : 'hot-fallback(anonymous)',
      greeting: userId ? null : '登录后可以告诉 AI 助手你想吃什么，直接帮你加购',
    };
  }
}
