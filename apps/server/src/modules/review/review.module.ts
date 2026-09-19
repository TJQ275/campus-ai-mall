import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AdminReviewController, ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';

@Module({
  imports: [AiModule],
  controllers: [ReviewController, AdminReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
