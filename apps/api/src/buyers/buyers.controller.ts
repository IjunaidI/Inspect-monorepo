import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BuyersService, CreateBuyerInput, UpdateBuyerInput } from './buyers.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller('buyers')
@Roles('QA_MANAGER')
export class BuyersController {
  constructor(private readonly buyers: BuyersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('includeArchived') includeArchived?: string) {
    return this.buyers.list(requireOrgId(user), { includeArchived: includeArchived === '1' });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buyers.get(requireOrgId(user), id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateBuyerInput) {
    return this.buyers.create(requireOrgId(user), user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateBuyerInput,
  ) {
    return this.buyers.update(requireOrgId(user), id, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.buyers.archive(requireOrgId(user), id);
  }
}
