import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { LoopPresetsService, CreateLoopPresetInput } from './loop-presets.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';
import { StorageService } from '../storage/storage.service';

@Controller('loop-presets')
@Roles('QA_MANAGER')
export class LoopPresetsController {
  constructor(
    private readonly presets: LoopPresetsService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery & { includeArchived?: string }) {
    return this.presets.list(requireOrgId(user), {
      ...parseListQuery(query),
      includeArchived: query.includeArchived === '1',
    });
  }

  /** Presigned PUT for a reference image (INS-052). MUST stay above @Get(':id')-style routes. */
  @Post('presign')
  presign(@CurrentUser() user: AuthUser, @Body() body: { ext?: string }) {
    const key = this.storage.keyForPresetImage(requireOrgId(user), body?.ext);
    return { storageKey: key, uploadUrl: this.storage.presignUpload(key) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const orgId = requireOrgId(user);
    const preset = await this.presets.get(orgId, id);
    // Reference images are stored as object keys — decorate with short-lived
    // view URLs (INS-049 pattern). Defense-in-depth: only ever presign keys in
    // THIS org's namespace, so the endpoint can't sign a foreign object even if
    // a bad key slipped past create-time validation.
    const refPrefix = `orgs/${orgId}/presets/`;
    return {
      ...preset,
      items: preset.items?.map((item) => {
        const key = item.referenceImageUrl;
        if (typeof key !== 'string' || !key.startsWith(refPrefix)) {
          return { ...item, referenceImage: null as { key: string; viewUrl: string | null } | null };
        }
        try {
          return { ...item, referenceImage: { key, viewUrl: this.storage.presignDownload(key) } };
        } catch {
          return { ...item, referenceImage: { key, viewUrl: null as string | null } };
        }
      }),
    };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateLoopPresetInput) {
    return this.presets.create(requireOrgId(user), user, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.presets.archive(requireOrgId(user), user, id);
  }
}
