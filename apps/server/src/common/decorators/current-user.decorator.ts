import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  sub: number;
  role: 'user' | 'admin';
  nickname: string;
}

/** 从 JWT 解出的当前用户：@CurrentUser() user: AuthUser */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});

/** 从 JWT 解出的当前用户：@CurrentUser() user: AuthUser */
export const OptionalUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
});
