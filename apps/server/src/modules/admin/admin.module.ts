import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AdminAiController, AdminKnowledgeController, AdminShopController } from './admin.controller.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminAiService } from './admin-ai.service.js';
import { AdminShopService } from './admin-shop.service.js';

@Module({
  imports: [AiModule, CatalogModule],
  controllers: [AdminAiController, AdminKnowledgeController, AdminShopController, AdminSettingsController],
  providers: [AdminAiService, AdminShopService],
  exports: [AdminAiService],
})
export class AdminModule {}
