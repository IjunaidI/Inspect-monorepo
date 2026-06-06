import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateDefectInput, DefectCatalogService } from './defect-catalog.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller('defect-catalog')
@Roles('QA_MANAGER')
export class DefectCatalogController {
  constructor(private readonly catalog: DefectCatalogService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.catalog.list(requireOrgId(user));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateDefectInput) {
    return this.catalog.create(requireOrgId(user), user.userId, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalog.archive(requireOrgId(user), id);
  }
}
