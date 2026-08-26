import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { CompaniesModule } from './companies/companies.module';
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
import { CompanyGuestsModule } from './company-guests/company-guests.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SearchModule } from './search/search.module';
import {
  authRateLimit,
  clientIpFromRequest,
  rateLimitDisabled,
} from './common/throttler.config';
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
      throw new Error(
        `${key} is required (set a strong secret; refusing a default/placeholder)`,
      );
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
        const ttl =
          Number(process.env.CACHE_TTL_MS) > 0
            ? Number(process.env.CACHE_TTL_MS)
            : 60 * 60 * 24 * 7 * 1000;
        const lruSize =
          Number(process.env.CACHE_LRU_SIZE) > 0
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
    /**
     * INS-047 — per-IP rate limiting for the unauthenticated surface.
     *
     * `ThrottlerGuard` is deliberately NOT an APP_GUARD: authenticated routes are
     * already gated by JwtAuthGuard + RolesGuard, and a blanket limiter would
     * throttle a legitimately busy console (and the DB-backed integration suite,
     * which drives everything from one IP). Instead the guard is attached
     * per-route with @UseGuards(ThrottlerGuard) + @Throttle on the @Public()
     * endpoints an attacker can reach — see auth/, invitations/, guest/.
     *
     * This module is @Global(), so those controllers resolve the guard's
     * dependencies without importing anything.
     *
     * The single named throttler ('public') carries the AUTH bucket as its
     * fallback, so a future public route that forgets @Throttle inherits the
     * TIGHTEST limit rather than none. ttl/limit are thunks because decorator
     * metadata is evaluated at import time — before ConfigModule has populated
     * process.env from the repo-root .env.
     */
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'public',
          ttl: () => authRateLimit().ttl,
          limit: () => authRateLimit().limit,
        },
      ],
      // Express has no `trust proxy` set in main.ts, so req.ip is the socket peer.
      // Resolve the real client ourselves, honouring RATE_LIMIT_TRUSTED_PROXIES.
      getTracker: (req) => clientIpFromRequest(req),
      skipIf: () => rateLimitDisabled(),
      errorMessage:
        'Too many requests — please slow down and try again shortly.',
    }),
    // INS-084: lets the OpenAPI generator read each route's @Roles floor,
    // which Swagger cannot see (it only knows types, not guards).
    DiscoveryModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
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
    CompanyGuestsModule,
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
