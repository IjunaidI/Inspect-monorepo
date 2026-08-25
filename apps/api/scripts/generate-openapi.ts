/**
 * INS-084 — write `openapi.json` from the live Nest route table.
 *
 * Committed output, regenerated in CI so a drifted copy fails the build: the
 * point of the artifact is that it can be trusted without re-deriving it.
 *
 * Needs DATABASE_URL + REDIS_URL because AppModule boots the real container
 * (CacheModule throws without Redis). It never listens on a port and never
 * serves a request.
 *
 *   pnpm api openapi:generate
 */
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/openapi';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const document = buildOpenApiDocument(app);
  const out = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n', 'utf8');

  const operations = Object.values(document.paths ?? {}).reduce(
    (n, item) => n + Object.keys(item as object).length,
    0,
  );
  const byRole = new Map<string, number>();
  for (const item of Object.values(document.paths ?? {})) {
    for (const op of Object.values(item as Record<string, { 'x-required-role'?: string }>)) {
      const role = op?.['x-required-role'] ?? 'UNKNOWN';
      byRole.set(role, (byRole.get(role) ?? 0) + 1);
    }
  }

  console.log(`openapi.json written: ${Object.keys(document.paths ?? {}).length} paths, ${operations} operations`);
  for (const [role, n] of [...byRole.entries()].sort()) console.log(`  ${role}: ${n}`);
  // A route with no resolved floor means the reflector missed it — that is a
  // silent hole in the contract, so fail rather than ship a misleading artifact.
  if (byRole.has('UNKNOWN')) {
    console.error('Some operations have no resolved role floor — the route reflection is incomplete.');
    process.exitCode = 1;
  }

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
