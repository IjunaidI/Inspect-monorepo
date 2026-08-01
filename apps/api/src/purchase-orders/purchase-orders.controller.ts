import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  PurchaseOrdersService,
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
} from './purchase-orders.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller('purchase-orders')
@Roles('QA_MANAGER')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.purchaseOrders.list(requireOrgId(user));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.purchaseOrders.get(requireOrgId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreatePurchaseOrderInput) {
    return this.purchaseOrders.create(requireOrgId(user), user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdatePurchaseOrderInput,
  ) {
    return this.purchaseOrders.update(requireOrgId(user), user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.purchaseOrders.remove(requireOrgId(user), user, id);
  }
}
