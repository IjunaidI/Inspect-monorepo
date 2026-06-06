import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.checkRedis(),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { database: { status: 'up' } };
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const key = '__health__';
    await this.cache.set(key, '1', 5000);
    const val = await this.cache.get(key);
    if (val !== '1') throw new Error('Redis read-back failed');
    return { redis: { status: 'up' } };
  }
}
