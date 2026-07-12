import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS (INS-053): explicit origins from ALLOWED_ORIGINS (comma-separated),
  // falling back to WEB_BASE_URL. Only a fully unconfigured dev setup stays
  // open — and says so at boot.
  const origins = (process.env.ALLOWED_ORIGINS ?? process.env.WEB_BASE_URL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.length > 0) {
    app.enableCors({ origin: origins });
  } else {
    new Logger('bootstrap').warn(
      'CORS is wide open — set ALLOWED_ORIGINS (or WEB_BASE_URL) for any real deployment',
    );
    app.enableCors();
  }
  const port = process.env.API_PORT ? +process.env.API_PORT : 3000;
  await app.listen(port);
}
bootstrap();
