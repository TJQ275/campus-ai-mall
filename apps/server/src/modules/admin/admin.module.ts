import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AdminAiController, AdminKnowledgeController, AdminShopController } from './admin.controller.js';
import { AdminAiService } from './admin-ai.service.js';
import { AdminShopService } from './admin-shop.service.js';

@Module({
  imports: [AiModule],
  controllers: [AdminAiController, AdminKnowledgeController, AdminShopController],
  providers: [AdminAiService, AdminShopService],
  exports: [AdminAiService],
})
export class AdminModule {}
