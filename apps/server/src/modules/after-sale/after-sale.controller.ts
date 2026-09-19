import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApplyAfterSaleRequest } from '@campus/shared';
import { AfterSaleService } from './after-sale.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { Roles, RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('售后')
@Controller('after-sales')
@UseGuards(JwtAuthGuard)
export class AfterSaleController {
  constructor(private readonly afterSale: AfterSaleService) {}

  @Post()
  @ApiOperation({ summary: '申请售后（AI 客服代提交时 source=ai）' })
  apply(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ApplyAfterSaleRequest)) body: ApplyAfterSaleRequest) {
    return this.afterSale.apply(user.sub, body);
  }

  @Get()
  @ApiOperation({ summary: '我的售后单' })
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.afterSale.list(user.sub, status);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '撤销售后申请' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.afterSale.cancel(user.sub, id);
  }
}

@ApiTags('管理端-售后')
@Controller('admin/after-sales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAfterSaleController {
  constructor(private readonly afterSale: AfterSaleService) {}

  @Get()
  @ApiOperation({ summary: '售后单分页查询' })
  list(@Query() query: { status?: string; keyword?: string; page?: string; pageSize?: string }) {
    return this.afterSale.adminList({
      status: query.status,
      keyword: query.keyword,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 10,
    });
  }

  @Post(':id/audit')
  @ApiOperation({ summary: '审核售后：同意则退款入账并回滚库存' })
  audit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { approve: boolean; remark?: string },
  ) {
    return this.afterSale.audit(id, {
      approve: body.approve === true,
      remark: body.remark ? String(body.remark).slice(0, 200) : undefined,
      adminId: user.sub,
    });
  }
}
