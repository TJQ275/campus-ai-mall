import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminLoginRequest, WxLoginRequest } from '@campus/shared';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // 登录接口限流：避免有人拿字典把管理员密码刷出来
  @Post('admin/login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: '管理后台登录（演示账号 admin / admin123）' })
  adminLogin(
    @Body(new ZodValidationPipe(AdminLoginRequest)) body: AdminLoginRequest,
    @Headers('x-forwarded-for') ip?: string,
  ) {
    return this.auth.adminLogin(body.username, body.password, ip);
  }

  @Post('wx/login')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: '小程序登录：code 换 token（未配置 WX_APPID 时走开发模式）' })
  wxLogin(@Body(new ZodValidationPipe(WxLoginRequest)) body: WxLoginRequest) {
    return this.auth.wxLogin(body.code, { nickname: body.nickname, avatar: body.avatar });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '当前登录用户' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}
