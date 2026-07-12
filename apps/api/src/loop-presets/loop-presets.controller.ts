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
    const preset = await this.presets.get(requireOrgId(user), id);
    // Reference images are stored as object keys — decorate with short-lived
    // view URLs (INS-049 pattern); presign problems degrade to null.
    return {
      ...preset,
      steps: preset.steps?.map((step) => ({
        ...step,
        referenceImages: (step.referenceImageUrls ?? []).map((key: string) => {
          try {
            return { key, viewUrl: this.storage.presignDownload(key) };
          } catch {
            return { key, viewUrl: null as string | null };
          }
        }),
      })),
    };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateLoopPresetInput) {
    return this.presets.create(requireOrgId(user), user.userId, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.presets.archive(requireOrgId(user), id);
  }
}
