import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('inspections/:id/report')
  @Roles('QA_MANAGER')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.generate(requireOrgId(user), user, id);
  }

  @Get('reports')
  @Roles('QA_MANAGER')
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery) {
    return this.reports.list(requireOrgId(user), parseListQuery(query));
  }

  @Get('reports/:id')
  @Roles('QA_MANAGER')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.getForOrg(requireOrgId(user), id);
  }

  /**
   * INS-003 — download the rendered PDF. Returns a short-lived presigned GET URL
   * rather than streaming bytes through the API (same design as photo viewing,
   * INS-049). Org-scoped + RBAC-guarded exactly like GET /reports/:id.
   */
  @Get('reports/:id/pdf')
  @Roles('QA_MANAGER')
  pdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.pdfDownload(requireOrgId(user), id);
  }

  /**
   * INS-020 — deliver the report to the buyer's guests (email + portal).
   *
   * An explicit act by the org, not a side effect of generate(): same QA_MANAGER
   * floor and org scoping as its neighbours. Re-delivering is allowed and appends
   * another ReportDelivery row.
   */
  @Post('reports/:id/deliver')
  @Roles('QA_MANAGER')
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reports.deliver(requireOrgId(user), user, id);
  }

  /** Public, no-auth verification page backend (spec §9). */
  @Public()
  @Get('reports/verify/:token')
  verify(@Param('token') token: string) {
    return this.reports.verifyByToken(token);
  }
}
