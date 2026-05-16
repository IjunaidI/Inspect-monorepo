import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.checkRedis(),
    ]);
  }

  private async checkRedis(): Promise<Record<string, any>> {
    const key = '__health__';
    await this.cache.set(key, '1', 5000);
    const val = await this.cache.get(key);
    if (val !== '1') throw new Error('Redis read-back failed');
    return { redis: { status: 'up' } };
  }
}
