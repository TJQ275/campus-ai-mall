import { z } from 'zod';
import type { ZodType } from 'zod';
import type { ProductCard } from '../../catalog/catalog.service.js';

export type AiScene = 'shopping' | 'support' | 'merchant';

export interface AiContext {
  userId: number;
  conversationId: number;
  scene: AiScene;
  /** 页面上下文：{ page: 'product', productId: 12 } —— 让「这个多少钱」有指代 */
  pageContext?: Record<string, unknown>;
}

export interface ToolResult {
  /** 一句话摘要：给模型看，也用于前端的 tool_result 事件 */
  brief: string;
  /** 结构化数据：回灌给模型，同时入库便于审计 */
  data: unknown;
  /** 需要渲染成商品卡片的列表 */
  cards?: ProductCard[];
}

export interface AiTool {
  name: string;
  description: string;
  /** 中文标签，前端显示「正在查询商品…」 */
  label: string;
  schema: ZodType;
  /** 写操作：不直接执行，先落 ai_pending_action 等用户确认 */
  write?: boolean;
  scenes?: AiScene[];
  /** 生成给用户看的确认文案 */
  confirmSummary?: (args: Record<string, unknown>, ctx: AiContext) => Promise<string>;
  run: (ctx: AiContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

/** Zod schema → OpenAI tools 需要的 JSON Schema（Zod 4 原生支持） */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    const fn = (schema as unknown as { toJSONSchema?: (options?: unknown) => Record<string, unknown> }).toJSONSchema;
    if (typeof fn === 'function') {
      const json = fn.call(schema, { io: 'input' }) as Record<string, unknown>;
      const { $schema: _drop, ...rest } = json;
      return rest;
    }
  } catch {
    // 落到下面的兜底：宁可让模型拿到空参数表，也不要让整个 Agent 起不来
  }
  return { type: 'object', properties: {}, additionalProperties: true };
}

export const _z = z;
