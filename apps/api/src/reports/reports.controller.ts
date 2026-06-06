import { Controller, Get, Param, Post } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('inspections/:id/report')
  @Roles('QA_MANAGER')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.generate(requireOrgId(user), id);
  }

  @Get('reports/:id')
  @Roles('QA_MANAGER')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.getForOrg(requireOrgId(user), id);
  }

  /** Public, no-auth verification page backend (spec §9). */
  @Public()
  @Get('reports/verify/:token')
  verify(@Param('token') token: string) {
    return this.reports.verifyByToken(token);
  }
}
