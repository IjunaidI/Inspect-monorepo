import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CreateInspectionInput,
  InspectionsService,
  QaDecisionInput,
  TamperProofInput,
} from './inspections.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller('inspections')
@Roles('QA_MANAGER')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.inspections.list(requireOrgId(user), status);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inspections.get(requireOrgId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateInspectionInput) {
    return this.inspections.create(requireOrgId(user), user.userId, body);
  }

  @Post(':id/submit')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: TamperProofInput,
  ) {
    return this.inspections.submit(requireOrgId(user), user.userId, id, body ?? {});
  }

  @Post(':id/decision')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: QaDecisionInput,
  ) {
    return this.inspections.decide(requireOrgId(user), user.userId, id, body);
  }
}
