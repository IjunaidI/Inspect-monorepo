import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { presignS3Url } from './sigv4';

/**
 * Placeholder detection (INS-060). `.env.example` ships `S3_ACCESS_KEY_ID="CHANGE_ME"`
 * and Railway template refs (`${{ Bucket.KEY }}`); those are NON-empty, so the old
 * emptiness-only guard let them through and the API happily minted signed URLs that
 * can never authenticate. A placeholder is a configuration error, not a credential —
 * fail exactly like "unset" so the operator gets a real message instead of a 403 from
 * the storage provider hours later.
 */
export function looksLikePlaceholder(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  if (!trimmed) return false; // emptiness is reported separately
  const lower = trimmed.toLowerCase();
  const squashed = lower.replace(/[\s_-]/g, '');
  if (squashed.includes('changeme')) return true;
  if (squashed.includes('replaceme')) return true;
  if (squashed.includes('fillme')) return true;
  if (squashed.includes('placeholder')) return true;
  if (squashed.includes('setmeplease')) return true;
  if (lower.startsWith('your')) return true; // your-access-key, yourbucket, ...
  if (/\byour[-_]/i.test(trimmed)) return true; // https://your-endpoint.example
  if (trimmed.includes('${')) return true; // ${{ Bucket.SECRET }} / ${VAR} left unexpanded
  if (/<[^>]*>/.test(trimmed)) return true; // <access-key-id>, https://<your-endpoint>
  if (/^x{3,}$/i.test(trimmed)) return true; // xxxxxxxx
  if (['todo', 'tbd', 'none', 'null', 'undefined', 'example', 'string'].includes(lower)) return true;
  return false;
}

interface ResolvedStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Boot-time visibility (INS-060): an unconfigured/placeholder bucket must not
   * be discovered only when an inspector's first photo upload 400s. Warn once at
   * startup; never throw — the API is fully usable without object storage (the
   * signed Report row is the product guarantee, the PDF is a rendition).
   */
  onModuleInit(): void {
    const problem = this.configProblem();
    if (problem) {
      this.logger.warn(
        `Object storage is NOT usable (${problem}) — presigned photo uploads/downloads and ` +
          'report PDF rendering will be unavailable until S3_* is set to real values.',
      );
    }
  }

  /** True when S3_* is complete and free of placeholder values. */
  isConfigured(): boolean {
    return this.configProblem() === null;
  }

  /** Deterministic, collision-resistant object key for an inspection photo. */
  keyForPhoto(orgId: string, inspectionId: string, ext = 'jpg'): string {
    const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext : 'jpg';
    return `orgs/${orgId}/inspections/${inspectionId}/photos/${randomUUID()}.${safeExt}`;
  }

  /** Object key for a loop-preset reference image (INS-052). */
  keyForPresetImage(orgId: string, ext = 'jpg'): string {
    const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext : 'jpg';
    return `orgs/${orgId}/presets/${randomUUID()}.${safeExt}`;
  }

  /**
   * Object key for a generated report PDF (INS-003). Deterministic per report so
   * a re-render overwrites its own rendition rather than orphaning objects; the
   * report id is already unique per inspection (Report.inspectionId is @unique).
   */
  keyForReportPdf(orgId: string, reportId: string): string {
    return `orgs/${orgId}/reports/${reportId}.pdf`;
  }

  /** Presigned PUT URL the client uploads to directly (no base64 through the API). */
  presignUpload(key: string, expiresSeconds = this.presignExpiry()): string {
    return this.presign(key, 'PUT', expiresSeconds);
  }

  /** Presigned GET URL so uploaded photos are actually viewable (INS-049). */
  presignDownload(key: string, expiresSeconds = this.presignExpiry()): string {
    return this.presign(key, 'GET', expiresSeconds);
  }

  /**
   * Server-side upload of bytes the API produced itself (the rendered report PDF).
   * Goes through the same dependency-free SigV4 presigner + a plain fetch PUT, so
   * object storage stays zero-dependency (no AWS SDK).
   *
   * Throws on any non-2xx so the caller can decide the failure policy; report
   * generation treats it as non-fatal.
   */
  async putObject(
    key: string,
    body: Uint8Array,
    contentType = 'application/octet-stream',
    timeoutMs = 20_000,
  ): Promise<void> {
    const url = this.presignUpload(key, 300);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        body: Buffer.from(body),
        headers: { 'content-type': contentType },
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `Object storage PUT ${key} failed: ${res.status} ${res.statusText}` +
            (detail ? ` — ${detail.slice(0, 300)}` : ''),
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private presignExpiry(): number {
    const configured = Number(this.config.get('PRESIGN_EXPIRES_SECONDS'));
    return configured > 0 ? configured : 900;
  }

  private storageConfig(): ResolvedStorageConfig {
    return {
      endpoint: this.config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000',
      region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
      bucket: this.config.get<string>('S3_BUCKET') ?? 'inspect-photos',
      accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID') ?? '',
      secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY') ?? '',
      forcePathStyle:
        (this.config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
    };
  }

  /** Human-readable reason storage is unusable, or null when it looks real. */
  private configProblem(): string | null {
    const c = this.storageConfig();
    const missing = (
      [
        ['S3_ACCESS_KEY_ID', c.accessKeyId],
        ['S3_SECRET_ACCESS_KEY', c.secretAccessKey],
      ] as const
    )
      .filter(([, v]) => !v.trim())
      .map(([k]) => k);
    if (missing.length > 0) {
      return `set ${missing.join(' / ')}`;
    }
    const placeholders = (
      [
        ['S3_ENDPOINT', c.endpoint],
        ['S3_REGION', c.region],
        ['S3_BUCKET', c.bucket],
        ['S3_ACCESS_KEY_ID', c.accessKeyId],
        ['S3_SECRET_ACCESS_KEY', c.secretAccessKey],
      ] as const
    )
      .filter(([, v]) => looksLikePlaceholder(v))
      .map(([k]) => k);
    if (placeholders.length > 0) {
      return `${placeholders.join(' / ')} still holds a placeholder value`;
    }
    // A malformed endpoint must surface as the same clear config error — the
    // SigV4 signer does `new URL(endpoint)` and would otherwise throw a bare
    // TypeError('Invalid URL') out of an unrelated-looking call stack.
    try {
      const parsed = new URL(c.endpoint);
      if (!/^https?:$/.test(parsed.protocol)) {
        return `S3_ENDPOINT must be an http(s) URL (got "${c.endpoint}")`;
      }
    } catch {
      return `S3_ENDPOINT is not a valid URL ("${c.endpoint}")`;
    }
    return null;
  }

  private presign(key: string, method: 'GET' | 'PUT', expiresSeconds: number): string {
    // Fail loudly (INS-053/INS-060): empty OR placeholder credentials would still
    // produce a signed-looking but permanently broken URL.
    const problem = this.configProblem();
    if (problem) {
      throw new BadRequestException(`Object storage is not configured (${problem})`);
    }
    const c = this.storageConfig();
    return presignS3Url({
      endpoint: c.endpoint,
      region: c.region,
      bucket: c.bucket,
      key,
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      expiresSeconds,
      now: new Date(),
      method,
      forcePathStyle: c.forcePathStyle,
    });
  }
}
