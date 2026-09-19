import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export interface RateLimitRule {
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 限流维度：按 IP 还是按登录用户 */
  by?: 'ip' | 'user';
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
      user?: { sub?: number };
    }>();

    const userKey = rule.by === 'user' ? request.user?.sub : undefined;
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    // by:'user' 时如果拿不到用户（例如没登录），退化成按 IP 限流，而不是不限流
    const key = (context.getClass().name ?? '') + ':' + (context.getHandler().name ?? '') + ':' + (userKey ?? ip);

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
