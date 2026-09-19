import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddCartRequest, UpdateCartRequest } from '@campus/shared';
import { CartService } from './cart.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('购物车')
@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: '购物车列表（含金额汇总与配送费）' })
  list(@CurrentUser() user: AuthUser) {
    return this.cart.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: '加入购物车（source=ai 表示由 AI 助手加入）' })
  add(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(AddCartRequest)) body: AddCartRequest) {
    return this.cart.add(user.sub, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改数量或勾选状态' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(UpdateCartRequest)) body: UpdateCartRequest,
  ) {
    return this.cart.update(user.sub, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除购物车条目' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.cart.remove(user.sub, id);
  }

  @Post('select-all')
  @ApiOperation({ summary: '全选 / 全不选' })
  selectAll(@CurrentUser() user: AuthUser, @Body() body: { selected: boolean }) {
    return this.cart.selectAll(user.sub, body.selected === true);
  }
}
