import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { AddressModule } from './modules/address/address.module.js';
import { OrderModule } from './modules/order/order.module.js';
import { AfterSaleModule } from './modules/after-sale/after-sale.module.js';
import { WalletModule } from './modules/wallet/wallet.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // 允许把 .env 放在仓库根目录（monorepo 习惯）
      envFilePath: ['.env', '../../.env'],
    }),
    DatabaseModule,
    AuthModule,
    CatalogModule,
    CartModule,
    AddressModule,
    OrderModule,
    AfterSaleModule,
    WalletModule,
    HealthModule,
  ],
})
export class AppModule {}