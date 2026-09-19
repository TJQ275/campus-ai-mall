import { Module } from '@nestjs/common';
import { AdminOrderController, OrderController } from './order.controller.js';
import { OrderService } from './order.service.js';

@Module({ controllers: [OrderController, AdminOrderController], providers: [OrderService], exports: [OrderService] })
export class OrderModule {}
