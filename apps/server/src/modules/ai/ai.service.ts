import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import {
  aiConversations, aiMessages, aiPendingActions, aiToolCalls, userProfiles, users,
} from '../../db/schema/index.js';
import type { LlmToolCall } from './provider/types.js';
import type { AiScene } from './tools/tool.types.js';

export interface AppendMessageInput {
  conversationId: number;
  userId: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  contentType?: 'text' | 'cards' | 'tool_calls' | 'tool_result';
  content: string;
  cards?: unknown[];
  attachments?: string[];
  toolCallId?: string | null;
  toolName?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  degraded?: boolean;
}

@Injectable()
export class AiService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async loadUser(userId: number) {
    const user = (await this.db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!user) throw new NotFoundException('用户不存在');
    const profile = (await this.db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1))[0] ?? null;
    return { id: user.id, nickname: user.nickname, profile };
  }

  async ensureConversation(
    userId: number,
    input: { conversationId?: number; scene?: AiScene; pageContext?: Record<string, unknown>; title?: string },
  ) {
    if (input.conversationId) {
      const found = await this.db
        .select()
        .from(aiConversations)
        .where(and(eq(aiConversations.id, input.conversationId), eq(aiConversations.userId, userId)))
        .limit(1);
      if (found[0]) return found[0];
    }
    const created = await this.db
      .insert(aiConversations)
      .values({
        userId,
        scene: input.scene ?? 'shopping',
        title: input.title?.slice(0, 40) ?? '新对话',
        pageContext: input.pageContext ?? null,
      })
      .returning();
    return created[0];
  }

  async appendMessage(input: AppendMessageInput) {
    const inserted = await this.db
      .insert(aiMessages)
      .values({
        conversationId: input.conversationId,
        userId: input.userId,
        role: input.role,
        contentType: input.contentType ?? 'text',
        content: input.content,
        cards: (input.cards ?? []) as Record<string, unknown>[],
        attachments: input.attachments ?? [],
        toolCallId: input.toolCallId ?? null,
        toolName: input.toolName ?? null,
        model: input.model ?? null,
        promptTokens: input.promptTokens ?? 0,
        completionTokens: input.completionTokens ?? 0,
        latencyMs: input.latencyMs ?? 0,
        degraded: input.degraded ?? false,
      })
      .returning();
    await this.db
      .update(aiConversations)
      .set({
        lastMessageAt: new Date(),
        messageCount: sql`${aiConversations.messageCount} + 1`,
        updatedAt: new Date(),
        ...(input.role === 'user' && input.content ? { title: input.content.slice(0, 40) } : {}),
      })
      .where(eq(aiConversations.id, input.conversationId));
    return inserted[0];
  }

  /** 只取最近 N 条用于重建上下文，避免 prompt 无限膨胀 */
  async history(conversationId: number, limit = 16) {
    const rows = await this.db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(desc(aiMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async recordToolCall(input: {
    conversationId: number;
    messageId?: number | null;
    userId: number;
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'ok' | 'error' | 'pending' | 'denied';
    error?: string;
    durationMs?: number;
  }) {
    const inserted = await this.db
      .insert(aiToolCalls)
      .values({
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        userId: input.userId,
        toolName: input.toolName,
        args: input.args,
        result: (input.result ?? null) as Record<string, unknown> | null,
        status: input.status,
        error: input.error ?? null,
        durationMs: input.durationMs ?? 0,
      })
      .returning();
    return inserted[0];
  }

  async createPendingAction(input: {
    conversationId: number;
    userId: number;
    actionType: string;
    summary: string;
    payload: Record<string, unknown>;
  }) {
    const created = await this.db
      .insert(aiPendingActions)
      .values({
        conversationId: input.conversationId,
        userId: input.userId,
        actionType: input.actionType,
        summary: input.summary,
        payload: input.payload,
        status: 'pending',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      .returning();
    return created[0];
  }

  async getPendingAction(userId: number, id: number) {
    const found = await this.db
      .select()
      .from(aiPendingActions)
      .where(and(eq(aiPendingActions.id, id), eq(aiPendingActions.userId, userId)))
      .limit(1);
    if (!found[0]) throw new NotFoundException('待确认操作不存在');
    return found[0];
  }

  async updatePendingAction(id: number, patch: Partial<{ status: string; resultMessage: string; confirmedAt: Date }>) {
    const updated = await this.db.update(aiPendingActions).set(patch).where(eq(aiPendingActions.id, id)).returning();
    return updated[0];
  }

  listConversations(userId: number) {
    return this.db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, userId))
      .orderBy(desc(aiConversations.lastMessageAt))
      .limit(30);
  }

  async listMessages(userId: number, conversationId: number) {
    const conversation = await this.db
      .select()
      .from(aiConversations)
      .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
      .limit(1);
    if (!conversation[0]) throw new NotFoundException('会话不存在');
    const messages = await this.db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.id));
    const actions = await this.db
      .select()
      .from(aiPendingActions)
      .where(and(eq(aiPendingActions.conversationId, conversationId), eq(aiPendingActions.status, 'pending')));
    return { conversation: conversation[0], messages, pendingActions: actions };
  }
}

export type { LlmToolCall };
