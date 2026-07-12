import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { presignS3Url } from './sigv4';

@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

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

  /** Presigned PUT URL the client uploads to directly (no base64 through the API). */
  presignUpload(key: string, expiresSeconds = this.presignExpiry()): string {
    return this.presign(key, 'PUT', expiresSeconds);
  }

  /** Presigned GET URL so uploaded photos are actually viewable (INS-049). */
  presignDownload(key: string, expiresSeconds = this.presignExpiry()): string {
    return this.presign(key, 'GET', expiresSeconds);
  }

  private presignExpiry(): number {
    const configured = Number(this.config.get('PRESIGN_EXPIRES_SECONDS'));
    return configured > 0 ? configured : 900;
  }

  private presign(key: string, method: 'GET' | 'PUT', expiresSeconds: number): string {
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    // Fail loudly (INS-053): empty credentials would still produce a
    // signed-looking but permanently broken URL.
    if (!accessKeyId || !secretAccessKey) {
      throw new BadRequestException(
        'Object storage is not configured (set S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY)',
      );
    }
    return presignS3Url({
      endpoint: this.config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000',
      region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
      bucket: this.config.get<string>('S3_BUCKET') ?? 'inspect-photos',
      key,
      accessKeyId,
      secretAccessKey,
      expiresSeconds,
      now: new Date(),
      method,
      forcePathStyle:
        (this.config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
    });
  }
}
