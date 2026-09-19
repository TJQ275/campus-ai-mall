import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('admin/login')
  @ApiOperation({ summary: '管理后台登录（演示账号 admin / admin123）' })
  adminLogin(@Body() body: { username: string; password: string }, @Headers('x-forwarded-for') ip?: string) {
    return this.auth.adminLogin(body.username, body.password, ip);
  }

  @Post('wx/login')
  @ApiOperation({ summary: '小程序登录：code 换 token（未配置 WX_APPID 时走开发模式）' })
  wxLogin(@Body() body: { code: string; nickname?: string; avatar?: string }) {
    return this.auth.wxLogin(body.code, { nickname: body.nickname, avatar: body.avatar });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '当前登录用户' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}
