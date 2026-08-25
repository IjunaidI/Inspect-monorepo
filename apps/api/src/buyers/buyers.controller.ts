import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BuyersService,
  CreateBuyerInput,
  UpdateBuyerInput,
} from './buyers.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';
import { StorageService } from '../storage/storage.service';

/**
 * Object-key namespace for buyer logos (INS-072). The key is built here rather
 * than in StorageService so the buyer namespace stays owned by this controller;
 * the org prefix is exactly what `logoViewUrl` re-checks before signing.
 */
export function buyerLogoPrefix(orgId: string): string {
  return `orgs/${orgId}/buyers/`;
}

@Controller('buyers')
@Roles('QA_MANAGER')
export class BuyersController {
  constructor(
    private readonly buyers: BuyersService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: RawListQuery & { includeArchived?: string },
  ) {
    const orgId = requireOrgId(user);
    const rows = await this.buyers.list(orgId, {
      ...parseListQuery(query),
      includeArchived: query.includeArchived === '1',
    });
    return rows.map((row) => this.withLogoViewUrl(orgId, row));
  }

  /**
   * Presigned PUT for a buyer logo (INS-072), mirroring POST /loop-presets/presign.
   * Declared ABOVE the `:id` routes so it can never be swallowed by the param.
   * Only the returned `storageKey` is persisted — never the presigned URL.
   */
  @Post('presign')
  presign(@CurrentUser() user: AuthUser, @Body() body: { ext?: string }) {
    const orgId = requireOrgId(user);
    const raw = body?.ext ?? '';
    const ext = /^[a-z0-9]{1,5}$/i.test(raw) ? raw.toLowerCase() : 'png';
    const key = `${buyerLogoPrefix(orgId)}${randomUUID()}.${ext}`;
    return {
      storageKey: key,
      uploadUrl: this.storage.presignUpload(key),
      method: 'PUT' as const,
    };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const orgId = requireOrgId(user);
    return this.withLogoViewUrl(orgId, await this.buyers.get(orgId, id));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateBuyerInput) {
    return this.buyers.create(requireOrgId(user), user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateBuyerInput,
  ) {
    return this.buyers.update(requireOrgId(user), user, id, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buyers.archive(requireOrgId(user), user, id);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buyers.restore(requireOrgId(user), user, id);
  }

  /** Decorate a buyer row with a render-time `logoViewUrl` (INS-072). */
  private withLogoViewUrl<T extends { logoUrl: string | null }>(
    orgId: string,
    buyer: T,
  ): T & { logoViewUrl: string | null } {
    return { ...buyer, logoViewUrl: this.logoViewUrl(orgId, buyer.logoUrl) };
  }

  /**
   * Resolve the durable `logoUrl` into something a browser can actually render:
   *   - legacy absolute http(s) URL (pre-INS-072 rows) → echoed verbatim, so no
   *     data migration is needed and old buyers keep rendering;
   *   - an object key inside THIS org's buyer namespace → freshly presigned GET,
   *     so the short-lived URL is never persisted or frozen into a snapshot;
   *   - anything else (a crafted foreign-org key, junk) → null. This is the
   *     tenant-isolation guard: without it the endpoint would be a signing
   *     oracle over any other tenant's objects (same defence as the loop-preset
   *     reference-image decoration).
   */
  private logoViewUrl(orgId: string, logoUrl: string | null): string | null {
    if (!logoUrl) return null;
    if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
    if (!logoUrl.startsWith(buyerLogoPrefix(orgId))) return null;
    try {
      return this.storage.presignDownload(logoUrl);
    } catch {
      // Storage unconfigured — degrade to "no logo" rather than failing the read.
      return null;
    }
  }
}
