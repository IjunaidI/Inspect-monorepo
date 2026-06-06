import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { LoopPresetsService, CreateLoopPresetInput } from './loop-presets.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller('loop-presets')
@Roles('QA_MANAGER')
export class LoopPresetsController {
  constructor(private readonly presets: LoopPresetsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.presets.list(requireOrgId(user));
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
