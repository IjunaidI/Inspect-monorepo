import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  SuppliersService,
  CreateSupplierInput,
  UpdateSupplierInput,
} from './suppliers.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';

@Controller('suppliers')
@Roles('QA_MANAGER')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery & { includeArchived?: string }) {
    return this.suppliers.list(requireOrgId(user), {
      ...parseListQuery(query),
      includeArchived: query.includeArchived === '1',
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.suppliers.get(requireOrgId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateSupplierInput) {
    return this.suppliers.create(requireOrgId(user), user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateSupplierInput,
  ) {
    return this.suppliers.update(requireOrgId(user), id, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.suppliers.archive(requireOrgId(user), id);
  }
}
