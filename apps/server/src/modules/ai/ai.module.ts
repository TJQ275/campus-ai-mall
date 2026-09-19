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

@Module({
  imports: [CatalogModule, CartModule, OrderModule, AfterSaleModule],
  controllers: [AiController],
  providers: [AiService, AgentService, LlmService, ToolRegistry, CatalogTools, TradeTools],
  exports: [AiService, AgentService, LlmService, ToolRegistry],
})
export class AiModule {}
