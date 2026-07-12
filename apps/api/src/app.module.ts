import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';
import { Keyv } from 'keyv';
import { KeyvCacheableMemory } from 'cacheable';
// NOTE: ScheduleModule was removed (INS-053) — zero cron/interval jobs exist.
// Re-register it when the first real job (e.g. expiring stale invitations) lands.
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
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';
import { ReportsModule } from './reports/reports.module';
import { GuestModule } from './guest/guest.module';
import { OrgsModule } from './orgs/orgs.module';
import { InvitationsModule } from './invitations/invitations.module';
import { UsersModule } from './users/users.module';
import { BuyerGuestsModule } from './buyer-guests/buyer-guests.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SearchModule } from './search/search.module';
import * as path from 'path';

/**
 * Fail-closed env validation (security review): refuse to boot without strong JWT
 * signing secrets. Mirrors the existing hard-fail on REDIS_URL — an unset secret
 * previously fell back to a source-visible default, letting anyone forge a
 * PLATFORM_ADMIN token.
 */
function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = config[key];
    const s = value == null ? '' : String(value).trim();
    if (s === '' || s.toUpperCase() === 'CHANGE_ME') {
      throw new Error(`${key} is required (set a strong secret; refusing a default/placeholder)`);
    }
  }
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
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
        // Tunable via env (INS-053); the old hardcoded values remain the defaults.
        const ttl = Number(process.env.CACHE_TTL_MS) > 0
          ? Number(process.env.CACHE_TTL_MS)
          : 60 * 60 * 24 * 7 * 1000;
        const lruSize = Number(process.env.CACHE_LRU_SIZE) > 0
          ? Number(process.env.CACHE_LRU_SIZE)
          : 5000;
        return {
          ttl,
          stores: [
            new Keyv({
              store: new KeyvCacheableMemory({ ttl, lruSize }),
            }),
            new KeyvRedis(redisUrl),
          ],
        };
      },
    }),
    PrismaModule,
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
    AuditModule,
    MailModule,
    ReportsModule,
    GuestModule,
    OrgsModule,
    InvitationsModule,
    UsersModule,
    BuyerGuestsModule,
    DashboardModule,
    SearchModule,
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
