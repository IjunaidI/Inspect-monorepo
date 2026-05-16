import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';
import { Keyv } from 'keyv';
import { KeyvCacheableMemory } from 'cacheable';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => ({
        ttl: 60 * 60 * 24 * 7 * 1000,
        stores: [
          new Keyv({
            store: new KeyvCacheableMemory({ ttl: 60 * 60 * 24 * 7 * 1000, lruSize: 5000 }),
          }),
          new KeyvRedis(
            process.env.REDISURL ||
              `redis://:${process.env.REDISPASSWORD}@${process.env.REDISHOST}:${process.env.REDISPORT}`,
          ),
        ],
      }),
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        host: process.env.POSTGRESHOST,
        port: +process.env.POSTGRESPORT,
        username: process.env.POSTGRESUSER,
        password: process.env.POSTGRESPASSWORD,
        database: process.env.POSTGRESDB,
        synchronize: true,
        entities: []
      })
    }),
    ScheduleModule.forRoot(),
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
