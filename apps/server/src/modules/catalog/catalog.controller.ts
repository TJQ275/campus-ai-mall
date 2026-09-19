import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductSearchQuery } from '@campus/shared';
import { CatalogService } from './catalog.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OptionalUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';

@ApiTags('商品')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: '分类列表（kind=snack|book）' })
  @ApiQuery({ name: 'kind', required: false, enum: ['snack', 'book'] })
  categories(@Query('kind') kind?: 'snack' | 'book') {
    return this.catalog.listCategories(kind);
  }

  @Get('products')
  @ApiOperation({ summary: '商品检索：关键词 + 结构化过滤（价格用「元」）' })
  search(@Query(new ZodValidationPipe(ProductSearchQuery)) query: ReturnType<typeof ProductSearchQuery.parse>) {
    return this.catalog.search(query);
  }

  @Get('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '商品详情（含 SKU / 图片 / AI 评论摘要）' })
  detail(@Param('id', ParseIntPipe) id: number, @OptionalUser() user?: AuthUser) {
    return this.catalog.detail(id, user?.sub);
  }

  @Get('home')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '首页聚合：Banner + 分类 + 热销 + 推荐' })
  @ApiQuery({ name: 'kind', required: false, enum: ['snack', 'book'] })
  home(@Query('kind') kind?: 'snack' | 'book', @OptionalUser() user?: AuthUser) {
    return this.catalog.home(kind, user?.sub);
  }
}
