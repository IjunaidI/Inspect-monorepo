import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ProductsService,
  CreateProductInput,
  UpdateProductInput,
} from './products.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery, RawListQuery } from '../common/list-query';

@Controller('products')
@Roles('QA_MANAGER')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: RawListQuery & { includeArchived?: string },
  ) {
    return this.products.list(requireOrgId(user), {
      ...parseListQuery(query),
      includeArchived: query.includeArchived === '1',
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.get(requireOrgId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateProductInput) {
    return this.products.create(requireOrgId(user), user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateProductInput,
  ) {
    return this.products.update(requireOrgId(user), user, id, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.archive(requireOrgId(user), user, id);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.restore(requireOrgId(user), user, id);
  }
}
