import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export interface RateLimitRule {
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /**
   * 限流维度：
   *   ip       按来源 IP
   *   user     按登录用户（需要放在 JwtAuthGuard 之后）
   *   ip+body  按「IP + 请求体里的账号」——登录接口用这个：
   *            有人拿字典刷某个账号时，不会把同一台机器上的其他账号一起锁死
   */
  by?: 'ip' | 'user' | 'ip+body';
  /** by:'ip+body' 时从请求体取哪个字段作为账号，默认 username */
  bodyKey?: string;
}

export const RATE_LIMIT_KEY = 'rate_limit';
/** 用法：@RateLimit({ limit: 5, windowMs: 60000 }) */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 极简内存限流器。
 *
 * 项目刻意不引入 Redis / @nestjs/throttler —— 交付时依赖越少越好，而单实例校园项目
 * 用进程内滑动窗口完全够用。多实例部署时需要换成 Redis 版本（见 docs/06）。
 *
 * 保护对象：登录（防暴力破解）、AI 对话（每次调用都花钱）、上传（防刷磁盘）。
 *
 * 用法：把 RateLimitGuard 放进 @UseGuards(JwtAuthGuard, RateLimitGuard) 里，
 * 顺序很重要 —— 放在 JwtAuthGuard 之后才能拿到 request.user，by:'user' 才生效。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<RateLimitRule>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      headers: Record<string, string | string[] | undefined>;
      body?: Record<string, unknown>;
      user?: { sub?: number };
    }>();

    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    // by:'user' 时如果拿不到用户（例如没登录），退化成按 IP 限流，而不是不限流
    let identity: string = ip;
    if (rule.by === 'user' && request.user?.sub !== undefined) {
      identity = 'u' + request.user.sub;
    } else if (rule.by === 'ip+body') {
      const field = rule.bodyKey ?? 'username';
      const value = request.body?.[field];
      identity = ip + '|' + (typeof value === 'string' && value ? value : '-');
    }
    const key = (context.getClass().name ?? '') + ':' + (context.getHandler().name ?? '') + ':' + identity;

    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      return true;
    }
    if (bucket.count >= rule.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException('操作太频繁了，请 ' + retryAfter + ' 秒后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    bucket.count += 1;
    return true;
  }

  /** 顺手清理过期桶，避免 Map 无限增长 */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}