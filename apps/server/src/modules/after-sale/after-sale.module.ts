import { Module } from '@nestjs/common';
import { AdminAfterSaleController, AfterSaleController } from './after-sale.controller.js';
import { AfterSaleService } from './after-sale.service.js';

@Module({ controllers: [AfterSaleController, AdminAfterSaleController], providers: [AfterSaleService], exports: [AfterSaleService] })
export class AfterSaleModule {}
