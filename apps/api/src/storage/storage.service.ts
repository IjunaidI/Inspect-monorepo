import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { presignS3PutUrl } from './sigv4';

@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

  /** Deterministic, collision-resistant object key for an inspection photo. */
  keyForPhoto(orgId: string, inspectionId: string, ext = 'jpg'): string {
    const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext : 'jpg';
    return `orgs/${orgId}/inspections/${inspectionId}/photos/${randomUUID()}.${safeExt}`;
  }

  /** Presigned PUT URL the client uploads to directly (no base64 through the API). */
  presignUpload(key: string, expiresSeconds = 900): string {
    return presignS3PutUrl({
      endpoint: this.config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000',
      region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
      bucket: this.config.get<string>('S3_BUCKET') ?? 'inspect-photos',
      key,
      accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID') ?? '',
      secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY') ?? '',
      expiresSeconds,
      now: new Date(),
      forcePathStyle:
        (this.config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
    });
  }
}
