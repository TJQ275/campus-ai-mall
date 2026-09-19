/**
 * AI 流式事件协议：前后端共同契约。
 * 前端按事件类型渲染，而不是拿到一段纯文本再猜 —— 这样工具调用过程可视化，卡片与确认按钮都有明确来源。
 */
export type AiEventType =
  | 'text'
  | 'tool_start'
  | 'tool_result'
  | 'cards'
  | 'action_confirm'
  | 'usage'
  | 'stage'
  | 'error'
  | 'done';

/** Agent 工作流阶段（与后端 workflow.ts 保持一致） */
export type AiWorkflowStage = 'understand' | 'plan' | 'act' | 'verify' | 'respond';

export interface AiProductCard {
  id: number;
  kind: string;
  title: string;
  subtitle?: string | null;
  cover?: string | null;
  priceCents: number;
  originalPriceCents?: number;
  sales?: number;
  stock?: number;
  tags?: string[];
  reason?: string;
}

export type AiEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; toolName: string; label: string }
  | { type: 'tool_result'; toolName: string; ok: boolean; brief: string }
  | { type: 'cards'; products: AiProductCard[] }
  | { type: 'action_confirm'; actionId: number; actionType: string; summary: string }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      model: string;
      degraded: boolean;
      latencyMs: number;
    }
  /**
   * 工作流阶段事件：理解意图 → 规划步骤 → 执行工具 → 校验回答 → 生成回复。
   * 前端可以把它渲染成一条进度轨迹，出问题时也能一眼看出卡在哪一步。
   */
  | { type: 'stage'; stage: AiWorkflowStage; label: string; status: 'start' | 'done'; brief?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; conversationId: number; messageId: number | null };

export interface AiChatInput {
  message: string;
  conversationId?: number;
  scene?: 'shopping' | 'support' | 'merchant';
  pageContext?: Record<string, unknown>;
  imageUrls?: string[];
}
