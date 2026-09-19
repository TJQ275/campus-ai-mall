import { Inject, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { loginLogs, userProfiles, users } from '../../db/schema/index.js';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  private sign(payload: { sub: number; role: 'user' | 'admin'; nickname: string }) {
    return this.jwt.signAsync(payload);
  }

  /** 管理后台登录：账号 + 密码 */
  async adminLogin(username: string, password: string, ip?: string) {
    const found = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    const user = found[0];
    const ok = Boolean(user) && verifyPassword(password, user?.passwordHash ?? null);

    await this.db.insert(loginLogs).values({
      userId: user?.id ?? null,
      username,
      ip: ip ?? null,
      success: ok,
      message: ok ? '登录成功' : '账号或密码错误',
    });

    if (!ok || !user) throw new UnauthorizedException('账号或密码错误');
    if (user.status !== 1) throw new UnauthorizedException('账号已被禁用');

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return {
      token: await this.sign({ sub: user.id, role: 'admin', nickname: user.nickname }),
      user: { id: user.id, nickname: user.nickname, avatar: user.avatar, role: user.role },
    };
  }

  /**
   * 小程序登录：wx.login 拿到 code，后端换 openid。
   * 未配置 WX_APPID 时走开发模式（code 直接映射为 openid），保证没有小程序账号也能联调。
   */
  async wxLogin(code: string, profile?: { nickname?: string; avatar?: string }) {
    const openid = await this.resolveOpenid(code);
    const existing = await this.db.select().from(users).where(eq(users.openid, openid)).limit(1);

    let user = existing[0];
    if (!user) {
      const inserted = await this.db
        .insert(users)
        .values({
          openid,
          nickname: profile?.nickname ?? '同学' + openid.slice(-4),
          avatar: profile?.avatar ?? null,
          role: 'user',
        })
        .returning();
      user = inserted[0];
      await this.db.insert(userProfiles).values({ userId: user.id }).onConflictDoNothing();
    } else if (profile?.nickname || profile?.avatar) {
      const updated = await this.db
        .update(users)
        .set({ nickname: profile.nickname ?? user.nickname, avatar: profile.avatar ?? user.avatar })
        .where(eq(users.id, user.id))
        .returning();
      user = updated[0];
    }

    await this.db.insert(loginLogs).values({ userId: user.id, username: user.openid, success: true, message: '小程序登录' });
    return {
      token: await this.sign({ sub: user.id, role: 'user', nickname: user.nickname }),
      user: { id: user.id, nickname: user.nickname, avatar: user.avatar, balanceCents: user.balanceCents },
      openid,
      devMode: !process.env.WX_APPID,
    };
  }

  private async resolveOpenid(code: string): Promise<string> {
    const appId = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (!appId || !secret) return 'dev-' + code;

    const url =
      'https://api.weixin.qq.com/sns/jscode2session?appid=' + appId +
      '&secret=' + secret + '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code';
    const response = await fetch(url);
    const data = (await response.json()) as { openid?: string; errmsg?: string };
    if (!data.openid) throw new UnauthorizedException('微信登录失败: ' + (data.errmsg ?? '未知错误'));
    return data.openid;
  }

  /** 当前登录用户 + 画像（前台「我的」与 AI 都需要） */
  async me(userId: number) {
    const found = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = found[0];
    if (!user) throw new UnauthorizedException('用户不存在');
    const profile = (await this.db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1))[0];
    const { passwordHash: _ignored, ...safe } = user;
    return { ...safe, profile: profile ?? null };
  }
}
