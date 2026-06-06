import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ProductsService,
  CreateProductInput,
  UpdateProductInput,
} from './products.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller('products')
@Roles('QA_MANAGER')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.products.list(requireOrgId(user));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.get(requireOrgId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateProductInput) {
    return this.products.create(requireOrgId(user), user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateProductInput,
  ) {
    return this.products.update(requireOrgId(user), id, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.archive(requireOrgId(user), id);
  }
}
