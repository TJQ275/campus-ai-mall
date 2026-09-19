import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DB } from '../../modules/database/database.module.js';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import type { AuthUser } from '../decorators/current-user.decorator.js';

/** 用户状态的短缓存：避免每个请求都打一次库，同时保证禁用后最多 15 秒生效 */
const STATUS_TTL_MS = 15_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly statusCache = new Map<number, { status: number; expiresAt: number }>();

  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const header = request.headers.authorization ?? request.headers.Authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('未登录，请先获取 token');

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }

    // 只验签名是不够的：管理员把用户禁用之后，对方手里的 token 在有效期内（默认 7 天）
    // 依然能继续下单。这里补上账号状态的实时校验。
    const status = await this.resolveStatus(payload.sub);
    if (status === undefined) throw new UnauthorizedException('账号不存在，请重新登录');
    if (status !== 1) throw new UnauthorizedException('账号已被禁用，请联系管理员');

    request.user = payload;
    return true;
  }

  private async resolveStatus(userId: number): Promise<number | undefined> {
    const cached = this.statusCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.status;

    const row = (await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1))[0];
    if (row) this.statusCache.set(userId, { status: row.status, expiresAt: Date.now() + STATUS_TTL_MS });
    else this.statusCache.delete(userId);
    return row?.status;
  }
}
