import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewRequest } from '@campus/shared';
import { ReviewService } from './review.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { Roles, RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('评价')
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('products/:id/reviews')
  @ApiOperation({ summary: '商品评价列表 + AI 摘要' })
  list(@Param('id', ParseIntPipe) id: number) {
    return this.review.listByProduct(id);
  }

  @Post('reviews')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '发表评价（提交后自动刷新 AI 摘要）' })
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ReviewRequest)) body: ReviewRequest) {
    return this.review.create(user.sub, body);
  }
}

@ApiTags('管理端-评价')
@Controller('admin/reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminReviewController {
  constructor(private readonly review: ReviewService) {}

  @Post(':productId/summarize')
  @ApiOperation({ summary: '重新生成评论摘要' })
  summarize(@Param('productId', ParseIntPipe) productId: number) {
    return this.review.summarize(productId);
  }
}
