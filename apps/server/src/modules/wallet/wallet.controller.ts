import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from './wallet.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('钱包')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: '余额概览' })
  info(@CurrentUser() user: AuthUser) {
    return this.wallet.info(user.sub);
  }

  @Get('logs')
  @ApiOperation({ summary: '余额流水' })
  logs(@CurrentUser() user: AuthUser) {
    return this.wallet.logs(user.sub);
  }

  @Post('recharge')
  @ApiOperation({ summary: '模拟充值（金额单位：分）' })
  recharge(@CurrentUser() user: AuthUser, @Body() body: { amountCents: number; channel?: 'wechat' | 'alipay' }) {
    return this.wallet.recharge(user.sub, body.amountCents, body.channel ?? 'wechat');
  }
}
