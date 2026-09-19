import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateOrderRequest, PayOrderRequest } from '@campus/shared';
import { OrderService } from './order.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard, Roles } from '../../common/guards/roles.guard.js';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('订单')
@Controller('orders')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class OrderController {
  constructor(private readonly order: OrderService) {}

  @Get('preview')
  @ApiOperation({ summary: '结算预览：勾选商品、金额、默认地址' })
  preview(@CurrentUser() user: AuthUser) {
    return this.order.preview(user.sub);
  }

  @Post()
  @RateLimit({ limit: 20, windowMs: 60_000, by: 'user' })
  @ApiOperation({ summary: '创建订单（source=ai 表示 AI 助手代下单）' })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CreateOrderRequest)) body: CreateOrderRequest) {
    return this.order.create(user.sub, body);
  }

  @Get('summary')
  @ApiOperation({ summary: '各状态订单数（「我的」页面角标，一次聚合查询）' })
  summary(@CurrentUser() user: AuthUser) {
    return this.order.summary(user.sub);
  }

  @Get()
  @ApiOperation({ summary: '我的订单（分页，status=all|pending_pay|paid|shipped|finished）' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: { status?: string; page?: string; pageSize?: string },
  ) {
    return this.order.pageForUser(user.sub, {
      status: query.status,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 10,
    });
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
    @Body(new ZodValidationPipe(PayOrderRequest)) body: PayOrderRequest,
  ) {
    return this.order.pay(user.sub, id, body.channel);
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
