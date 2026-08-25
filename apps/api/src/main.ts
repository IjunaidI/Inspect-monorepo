import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS (INS-053): explicit origins from ALLOWED_ORIGINS (comma-separated),
  // falling back to WEB_BASE_URL. Only a fully unconfigured dev setup stays
  // open — and says so at boot.
  const origins = (
    process.env.ALLOWED_ORIGINS ??
    process.env.WEB_BASE_URL ??
    ''
  )
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
  // INS-084: browsable contract at /docs. Off in production — the document
  // enumerates every route and its role floor, which is a map of the attack
  // surface; the committed openapi.json is the artifact tooling should read.
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
  }

  const port = process.env.API_PORT ? +process.env.API_PORT : 3000;
  await app.listen(port);
}
bootstrap();
