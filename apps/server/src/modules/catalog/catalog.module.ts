import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { RecommendService } from './recommend.service.js';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, RecommendService],
  exports: [CatalogService, RecommendService],
})
export class CatalogModule {}
