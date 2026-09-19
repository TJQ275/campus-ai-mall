import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddressRequest } from '@campus/shared';
import { AddressService } from './address.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('收货地址')
@Controller('addresses')
@UseGuards(JwtAuthGuard)
export class AddressController {
  constructor(private readonly address: AddressService) {}

  @Get()
  @ApiOperation({ summary: '地址列表' })
  list(@CurrentUser() user: AuthUser) {
    return this.address.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: '新增地址' })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(AddressRequest)) body: AddressRequest) {
    return this.address.create(user.sub, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改地址（部分字段）' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(AddressRequest.partial())) body: Partial<AddressRequest>,
  ) {
    return this.address.update(user.sub, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除地址' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.address.remove(user.sub, id);
  }
}
