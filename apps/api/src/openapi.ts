import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { IS_PUBLIC_KEY } from './auth/public.decorator';
import { ROLES_KEY } from './auth/roles.decorator';

/**
 * INS-084 — a generated, machine-readable statement of the API surface.
 *
 * The contract used to exist only as decorators spread across 17 controllers and
 * then hand-redeclared in the console, which is the same root cause as INS-008.
 * A generated document gives `@inspect/api-client` something to be verified
 * against and gives a migration session one artifact to read instead of
 * re-deriving each route from controller + service.
 *
 * The important addition over a stock Swagger document is `x-required-role`.
 * Every route in this API is guarded by default (`JwtAuthGuard` + `RolesGuard`
 * are global `APP_GUARD`s), so the role floor is the single most load-bearing
 * fact about an endpoint — and it is invisible to Swagger, which only sees
 * types. It is exactly what surfaced INS-083: populate was `PLATFORM_ADMIN`-only
 * across every route, and nothing in the contract said so.
 *
 * Note on fidelity: request/response schemas are thin, because the DTOs carry no
 * `@ApiProperty` decorators. That is deliberate for now — the value here is a
 * complete, verifiable route inventory with its guards, not perfect model
 * schemas. Annotating DTOs is worthwhile once `@inspect/api-client` exists to
 * consume them.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Inspect API')
    .setDescription(
      'Tamper-proof, AQL-driven pre-shipment QC inspection platform. ' +
        'Every route is guarded by default; `x-required-role` on each operation ' +
        'records the additive-hierarchy floor (INSPECTOR < QA_MANAGER < ORG_OWNER ' +
        '< PLATFORM_ADMIN), or "public" for unauthenticated routes.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  annotateRequiredRoles(app, document);
  return document;
}

/** `GET /buyers/:id` → the guard floor that actually applies to it. */
function collectRouteRoles(app: INestApplication): Map<string, string> {
  const discovery = app.get(DiscoveryService);
  const roles = new Map<string, string>();

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype;
    if (!controller) continue;

    const basePath = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    const classRole = Reflect.getMetadata(ROLES_KEY, controller);
    const prototype = controller.prototype;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      const handler = prototype[name];
      if (typeof handler !== 'function') continue;

      const methodPath = Reflect.getMetadata(PATH_METADATA, handler);
      if (methodPath === undefined) continue;

      const verb =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) ?? 0];
      // A method-level @Roles overrides the class floor; @Public bypasses auth
      // entirely, which the RolesGuard never even reaches.
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
      const role = isPublic
        ? 'public'
        : (Reflect.getMetadata(ROLES_KEY, handler) ?? classRole);

      roles.set(
        `${verb} ${joinPath(basePath, methodPath)}`,
        role ?? 'authenticated',
      );
    }
  }
  return roles;
}

/** Nest path segments → an OpenAPI path (`:id` becomes `{id}`). */
function joinPath(base: string, method: string): string {
  const parts = [base, method].filter((p) => p && p !== '/');
  const joined =
    '/' +
    parts
      .join('/')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/{2,}/g, '/');
  return joined.replace(/:([^/]+)/g, '{$1}');
}

function annotateRequiredRoles(
  app: INestApplication,
  document: OpenAPIObject,
): void {
  const roles = collectRouteRoles(app);
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [verb, operation] of Object.entries(
      item as Record<string, unknown>,
    )) {
      const role = roles.get(`${verb.toUpperCase()} ${path}`);
      if (role && operation && typeof operation === 'object') {
        (operation as Record<string, unknown>)['x-required-role'] = role;
      }
    }
  }
}
