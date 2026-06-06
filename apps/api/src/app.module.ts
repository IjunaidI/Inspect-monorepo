import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';
import { Keyv } from 'keyv';
import { KeyvCacheableMemory } from 'cacheable';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { BuyersModule } from './buyers/buyers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProductsModule } from './products/products.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { LoopPresetsModule } from './loop-presets/loop-presets.module';
import { InspectionsModule } from './inspections/inspections.module';
import { StorageModule } from './storage/storage.module';
import { DefectCatalogModule } from './defect-catalog/defect-catalog.module';
import { PopulateModule } from './populate/populate.module';
import * as path from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(process.cwd(), '../../.env'),
        path.resolve(process.cwd(), '.env'),
      ],
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          throw new Error('REDIS_URL is required');
        }
        return {
          ttl: 60 * 60 * 24 * 7 * 1000,
          stores: [
            new Keyv({
              store: new KeyvCacheableMemory({
                ttl: 60 * 60 * 24 * 7 * 1000,
                lruSize: 5000,
              }),
            }),
            new KeyvRedis(redisUrl),
          ],
        };
      },
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    HealthModule,
    AuthModule,
    BuyersModule,
    SuppliersModule,
    ProductsModule,
    PurchaseOrdersModule,
    LoopPresetsModule,
    InspectionsModule,
    StorageModule,
    DefectCatalogModule,
    PopulateModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global auth: JwtAuthGuard first (populates request.user), then RolesGuard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
