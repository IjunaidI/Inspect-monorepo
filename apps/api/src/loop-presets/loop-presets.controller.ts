import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { LoopPresetsService, CreateLoopPresetInput } from './loop-presets.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';

@Controller('loop-presets')
@Roles('QA_MANAGER')
export class LoopPresetsController {
  constructor(private readonly presets: LoopPresetsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery & { includeArchived?: string }) {
    return this.presets.list(requireOrgId(user), {
      ...parseListQuery(query),
      includeArchived: query.includeArchived === '1',
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.presets.get(requireOrgId(user), id);
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
