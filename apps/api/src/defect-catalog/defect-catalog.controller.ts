import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateDefectInput, DefectCatalogService } from './defect-catalog.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

/**
 * INS-083: the class floor stays `QA_MANAGER` — curating the catalog is a QA
 * responsibility — but `GET` drops to `INSPECTOR`. An inspector tagging a
 * defect during populate has to be able to read the list they are tagging from,
 * and the mobile app (INS-086) carries no higher role. Reads are org-scoped by
 * `requireOrgId` plus the global rows, so widening the read exposes nothing an
 * inspector cannot already see on the inspection itself.
 */
@Controller('defect-catalog')
@Roles('QA_MANAGER')
export class DefectCatalogController {
  constructor(private readonly catalog: DefectCatalogService) {}

  @Get()
  @Roles('INSPECTOR')
  list(@CurrentUser() user: AuthUser) {
    return this.catalog.list(requireOrgId(user));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateDefectInput) {
    return this.catalog.create(requireOrgId(user), user, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalog.archive(requireOrgId(user), user, id);
  }
}
