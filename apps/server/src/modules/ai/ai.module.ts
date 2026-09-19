import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CartModule } from '../cart/cart.module.js';
import { OrderModule } from '../order/order.module.js';
import { AfterSaleModule } from '../after-sale/after-sale.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AgentService } from './agent.service.js';
import { LlmService } from './llm.service.js';
import { ToolRegistry } from './tools/tool.registry.js';
import { CatalogTools } from './tools/catalog.tools.js';
import { TradeTools } from './tools/trade.tools.js';
import { KnowledgeTools } from './tools/knowledge.tools.js';
import { MediaTools } from './tools/media.tools.js';
import { MerchantTools } from './tools/merchant.tools.js';
import { CopywritingService } from './copywriting.service.js';
import { EmbeddingService } from './embedding.service.js';

@Module({
  imports: [CatalogModule, CartModule, OrderModule, AfterSaleModule],
  controllers: [AiController],
  providers: [
    AiService,
    AgentService,
    LlmService,
    EmbeddingService,
    ToolRegistry,
    CatalogTools,
    TradeTools,
    KnowledgeTools,
    MediaTools,
    MerchantTools,
    CopywritingService,
  ],
  exports: [AiService, AgentService, LlmService, EmbeddingService, CopywritingService, ToolRegistry],
})
export class AiModule {}