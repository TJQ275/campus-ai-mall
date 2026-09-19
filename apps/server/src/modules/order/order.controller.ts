import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderService, type CreateOrderInput } from './order.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard, Roles } from '../../common/guards/roles.guard.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('订单')
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderController {
  constructor(private readonly order: OrderService) {}

  @Get('preview')
  @ApiOperation({ summary: '结算预览：勾选商品、金额、默认地址' })
  preview(@CurrentUser() user: AuthUser) {
    return this.order.preview(user.sub);
  }

  @Post()
  @ApiOperation({ summary: '创建订单（source=ai 表示 AI 助手代下单）' })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateOrderInput) {
    return this.order.create(user.sub, body);
  }

  @Get()
  @ApiOperation({ summary: '我的订单（status=all|pending_pay|paid|shipped|finished）' })
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.order.list(user.sub, status);
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.order.detail(user.sub, id);
  }

  @Post(':id/pay')
  @ApiOperation({ summary: '模拟支付：wechat | alipay | balance' })
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { channel: 'wechat' | 'alipay' | 'balance' },
  ) {
    return this.order.pay(user.sub, id, body.channel ?? 'wechat');
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '取消订单' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.order.cancel(user.sub, id);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: '确认收货' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.order.confirm(user.sub, id);
  }
}

@ApiTags('管理端-订单')
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrderController {
  constructor(private readonly order: OrderService) {}

  @Get()
  @ApiOperation({ summary: '订单分页查询' })
  list(@Query() query: { status?: string; keyword?: string; page?: string; pageSize?: string }) {
    return this.order.adminList({
      status: query.status,
      keyword: query.keyword,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 10,
    });
  }

  @Post(':id/ship')
  @ApiOperation({ summary: '发货' })
  ship(@Param('id', ParseIntPipe) id: number) {
    return this.order.ship(id);
  }

  @Get('dashboard')
  @ApiOperation({ summary: '数据概览：KPI + 趋势 + 分类销量 + 支付渠道' })
  dashboard() {
    return this.order.dashboard();
  }
}
