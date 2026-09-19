import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CartService } from '../../cart/cart.service.js';
import { OrderService } from '../../order/order.service.js';
import { AfterSaleService } from '../../after-sale/after-sale.service.js';
import { DB } from '../../database/database.module.js';
import type { Db } from '../../../db/client.js';
import { afterSales, orderItems, orders, products } from '../../../db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import type { AiTool, ToolResult } from './tool.types.js';

const yuan = (cents: number) => '¥' + (cents / 100).toFixed(2);

/** 交易类工具：购物车、订单、售后。其中写操作统一走「二次确认」 */
@Injectable()
export class TradeTools {
  constructor(
    private readonly cart: CartService,
    private readonly order: OrderService,
    private readonly afterSale: AfterSaleService,
    @Inject(DB) private readonly db: Db,
  ) {}

  all(): AiTool[] {
    return [this.getCart(), this.addToCart(), this.getMyOrders(), this.applyAfterSale()];
  }

  private getCart(): AiTool {
    return {
      name: 'get_cart',
      label: '正在查看购物车',
      description: '查看当前用户的购物车内容、件数与合计金额。',
      schema: z.object({}),
      run: async (ctx): Promise<ToolResult> => {
        const result = await this.cart.list(ctx.userId);
        return {
          brief: '购物车 ' + result.totalCount + ' 件，合计 ' + yuan(result.totalCents),
          data: {
            totalCount: result.totalCount,
            totalCents: result.totalCents,
            total: yuan(result.totalCents),
            freightCents: result.freightCents,
            items: result.list.map((i) => ({ cartItemId: i.id, title: i.title, price: yuan(i.priceCents), quantity: i.quantity, selected: i.selected })),
          },
        };
      },
    };
  }

  private addToCart(): AiTool {
    return {
      name: 'add_to_cart',
      label: '准备加入购物车',
      description: '把商品加入购物车。这是写操作：系统会先让用户确认，确认后才真正写入。',
      write: true,
      schema: z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(20).optional().describe('数量，默认 1'),
      }),
      confirmSummary: async (args) => {
        const product = (await this.db.select().from(products).where(eq(products.id, Number(args.productId))).limit(1))[0];
        const quantity = Number(args.quantity ?? 1);
        if (!product) return '加入购物车';
        return '加购 ' + product.title + ' × ' + quantity + '，合计 ' + yuan(product.priceCents * quantity);
      },
      run: async (ctx, args): Promise<ToolResult> => {
        const added = await this.cart.add(ctx.userId, {
          productId: Number(args.productId),
          quantity: Number(args.quantity ?? 1),
          source: 'ai',
        });
        const product = (await this.db.select().from(products).where(eq(products.id, Number(args.productId))).limit(1))[0];
        return {
          brief: '已加购「' + (product?.title ?? '商品') + '」×' + String(args.quantity ?? 1),
          data: { cartItemId: added.id, title: product?.title, quantity: added.quantity, productId: added.productId },
        };
      },
    };
  }

  private getMyOrders(): AiTool {
    return {
      name: 'get_my_orders',
      label: '正在查询你的订单',
      description: '查询当前用户的订单列表，可按状态筛选。回答「我的订单到哪了」「能退吗」之前先调用它。',
      schema: z.object({
        status: z.enum(['all', 'pending_pay', 'paid', 'shipped', 'finished', 'cancelled']).optional(),
      }),
      run: async (ctx, args): Promise<ToolResult> => {
        const list = await this.order.list(ctx.userId, (args.status as string) ?? 'all');
        return {
          brief: '共 ' + list.length + ' 笔订单',
          data: {
            orders: list.map((o) => ({
              orderId: o.id, orderNo: o.orderNo, status: o.status, payCents: o.payCents, amount: yuan(o.payCents),
              createdAt: o.createdAt, source: o.source,
              items: o.items.map((i) => ({ orderItemId: i.id, productId: i.productId, title: i.titleSnapshot, quantity: i.quantity, refundStatus: i.refundStatus })),
            })),
          },
        };
      },
    };
  }

  private applyAfterSale(): AiTool {
    return {
      name: 'apply_after_sale',
      label: '准备提交售后申请',
      description:
        '为某个订单商品申请退款或退货退款。这是写操作，需要用户确认。调用前必须先用 get_my_orders 拿到 orderItemId，并向用户复述退的是哪件商品、金额多少。',
      write: true,
      schema: z.object({
        orderItemId: z.number().int().positive().describe('订单商品 ID，来自 get_my_orders 的 items[].orderItemId'),
        reason: z.string().min(2).max(60).describe('退款原因，如 不想要了 / 商品破损'),
        description: z.string().max(200).optional(),
        type: z.enum(['refund', 'return']).optional().describe('refund=仅退款，return=退货退款'),
      }),
      confirmSummary: async (args) => {
        const item = (await this.db.select().from(orderItems).where(eq(orderItems.id, Number(args.orderItemId))).limit(1))[0];
        if (!item) return '提交售后申请';
        return '为「' + item.titleSnapshot + '」申请退款 ' + yuan(item.priceCents * item.quantity) + '，原因：' + String(args.reason);
      },
      run: async (ctx, args): Promise<ToolResult> => {
        const created = await this.afterSale.apply(ctx.userId, {
          orderItemId: Number(args.orderItemId),
          type: (args.type as 'refund' | 'return') ?? 'refund',
          reason: String(args.reason),
          description: args.description as string | undefined,
          source: 'ai',
        });
        return {
          brief: '售后单 ' + created.afterSaleNo + ' 已提交，等待审核',
          data: { afterSaleNo: created.afterSaleNo, amountCents: created.amountCents, amount: yuan(created.amountCents), status: created.status },
        };
      },
    };
  }

  /** 供 Agent 判断某个订单项是否属于该用户（防止越权退款） */
  async ownsOrderItem(userId: number, orderItemId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: orderItems.id })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(eq(orderItems.id, orderItemId), eq(orders.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  /** 售后单归属校验，确认执行前再查一次 */
  async findAfterSale(id: number) {
    return (await this.db.select().from(afterSales).where(eq(afterSales.id, id)).limit(1))[0];
  }
}
