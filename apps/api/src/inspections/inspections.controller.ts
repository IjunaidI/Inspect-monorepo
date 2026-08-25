import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateInspectionInput,
  InspectionsService,
  QaDecisionInput,
  TamperProofInput,
  UpdateInspectionInput,
} from './inspections.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';
import { StorageService } from '../storage/storage.service';

interface PhotoLike {
  storageKey: string;
}

/**
 * Class floor: QA_MANAGER. Read + inspector-workflow routes relax to INSPECTOR
 * per-handler (RolesGuard resolves handler-over-class, INS-057); the service
 * then scopes INSPECTOR access to their own assigned inspections.
 */
@Controller('inspections')
@Roles('QA_MANAGER')
export class InspectionsController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Decorate photos with short-lived presigned GET URLs (INS-049) so evidence
   * is viewable. Must never fail the read — a presign problem degrades to
   * viewUrl:null and the UI falls back to its placeholder tile.
   */
  private withViewUrl<T extends PhotoLike>(
    photo: T,
  ): T & { viewUrl: string | null } {
    try {
      return {
        ...photo,
        viewUrl: this.storage.presignDownload(photo.storageKey),
      };
    } catch {
      return { ...photo, viewUrl: null };
    }
  }

  @Get()
  @Roles('INSPECTOR')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: RawListQuery & { status?: string },
  ) {
    return this.inspections.list(
      requireOrgId(user),
      user,
      query.status,
      parseListQuery(query),
    );
  }

  @Get('aql-preview')
  preview(
    @Query('lotSize') lotSize?: string,
    @Query('critical') critical?: string,
    @Query('major') major?: string,
    @Query('minor') minor?: string,
  ) {
    const num = (v?: string) =>
      v === undefined || v === '' ? undefined : Number(v);
    return this.inspections.aqlPreview(Number(lotSize), {
      critical: num(critical),
      major: num(major),
      minor: num(minor),
    });
  }

  @Get(':id')
  @Roles('INSPECTOR')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const inspection = await this.inspections.get(requireOrgId(user), user, id);
    // INS-081: there is no orphan photo list any more — every photo lives in a
    // (loop item, cycle) slot, so the view URLs are decorated per item.
    return {
      ...inspection,
      items: inspection.items?.map((item) => ({
        ...item,
        photos: item.photos?.map((p) => this.withViewUrl(p)),
      })),
    };
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateInspectionInput) {
    return this.inspections.create(requireOrgId(user), user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateInspectionInput,
  ) {
    return this.inspections.update(requireOrgId(user), user, id, body ?? {});
  }

  @Post(':id/start')
  @Roles('INSPECTOR')
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.start(requireOrgId(user), user, id);
  }

  @Post(':id/reset')
  @Roles('INSPECTOR')
  reset(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.reset(requireOrgId(user), user, id);
  }

  @Post(':id/submit')
  @Roles('INSPECTOR')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: TamperProofInput,
  ) {
    return this.inspections.submit(requireOrgId(user), user, id, body ?? {});
  }

  @Post(':id/decision')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: QaDecisionInput,
  ) {
    return this.inspections.decide(requireOrgId(user), user, id, body);
  }
}
