import { ConfigService } from '@nestjs/config';

/**
 * Read a required JWT signing secret. There is NO fallback: a missing or
 * placeholder value throws rather than silently signing/verifying tokens with a
 * source-visible default (which would let anyone forge a PLATFORM_ADMIN token).
 * Boot-time validation (app.module `validate`) fails the process early; this is
 * the fail-closed guard at the point of use. (Security review.)
 */
export function requireSecret(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value || value.trim() === '' || value.trim().toUpperCase() === 'CHANGE_ME') {
    throw new Error(`${key} is required (set a strong secret; refusing a default/placeholder)`);
  }
  return value;
}
