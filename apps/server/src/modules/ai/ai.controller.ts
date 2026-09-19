import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ChatRequest, ConfirmActionRequest, type AiEvent } from '@campus/shared';
import { AgentService } from './agent.service.js';
import { AiService } from './ai.service.js';
import { LlmService } from './llm.service.js';
import { ToolRegistry } from './tools/tool.registry.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('AI 助手')
@Controller('ai')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class AiController {
  constructor(
    private readonly agent: AgentService,
    private readonly ai: AiService,
    private readonly llm: LlmService,
    private readonly registry: ToolRegistry,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'AI 运行状态：走真实模型还是本地降级' })
  status() {
    return { ...this.llm.status(), tools: this.registry.list().map((t) => ({ name: t.name, label: t.label, write: Boolean(t.write) })) };
  }

  @Post('chat')
  @RateLimit({ limit: 30, windowMs: 60_000, by: 'user' })
  @ApiOperation({ summary: '流式对话（SSE）：text / tool_start / tool_result / cards / action_confirm / usage / done' })
  async chat(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChatRequest)) body: ChatRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 客户端断开（切页面 / 断网 / 关闭小程序）→ 中止这一轮，
    // 否则模型调用和工具轮次会在后台继续跑完，token 白烧
    const abort = new AbortController();
    const onClose = () => abort.abort();
    req.on('close', onClose);

    let closed = false;
    const send = (event: AiEvent) => {
      if (closed || res.writableEnded) return;
      res.write('event: ' + event.type + '\n');
      res.write('data: ' + JSON.stringify(event) + '\n\n');
    };

    // 心跳：长回答期间代理/网关会因空闲而切断连接，注释帧可以保活
    const heartbeat = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    try {
      for await (const event of this.agent.run(user.sub, body, { signal: abort.signal })) send(event);
    } catch (error) {
      if (!abort.signal.aborted) {
        send({ type: 'error', message: (error as Error).message ?? '服务异常' });
      }
      send({ type: 'done', conversationId: Number(body.conversationId ?? 0), messageId: null });
    } finally {
      closed = true;
      clearInterval(heartbeat);
      req.off('close', onClose);
      res.end();
    }
  }

  @Post('chat/sync')
  @RateLimit({ limit: 30, windowMs: 60_000, by: 'user' })
  @ApiOperation({ summary: '非流式对话：返回完整事件列表与最终回复（便于联调与自动化测试）' })
  async chatSync(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ChatRequest)) body: ChatRequest) {
    const events: AiEvent[] = [];
    let reply = '';
    for await (const event of this.agent.run(user.sub, body)) {
      events.push(event);
      if (event.type === 'text') reply += event.delta;
    }
    const done = events.find((e) => e.type === 'done') as { conversationId?: number } | undefined;
    return {
      conversationId: done?.conversationId ?? null,
      reply,
      cards: events.filter((e) => e.type === 'cards').flatMap((e) => (e as { products: unknown[] }).products),
      pendingActions: events.filter((e) => e.type === 'action_confirm'),
      toolCalls: events.filter((e) => e.type === 'tool_start' || e.type === 'tool_result'),
      usage: events.find((e) => e.type === 'usage') ?? null,
      events,
    };
  }

  @Get('conversations')
  @ApiOperation({ summary: '我的会话列表' })
  conversations(@CurrentUser() user: AuthUser) {
    return this.ai.listConversations(user.sub);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: '会话消息与待确认操作' })
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.ai.listMessages(user.sub, id);
  }

  @Post('actions/:id/confirm')
  @ApiOperation({ summary: '确认或取消 AI 发起的写操作（加购 / 售后）' })
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(ConfirmActionRequest.pick({ decision: true }).partial()))
    body: { decision?: 'confirm' | 'cancel' },
  ) {
    return this.agent.confirmAction(user.sub, id, body.decision ?? 'confirm');
  }
}
