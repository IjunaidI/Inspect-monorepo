import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  CompanyGuestsService,
  InviteGuestInput,
} from './company-guests.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller()
@Roles('QA_MANAGER')
export class CompanyGuestsController {
  constructor(private readonly guests: CompanyGuestsService) {}

  @Get('companies/:companyId/guests')
  list(@CurrentUser() user: AuthUser, @Param('companyId') companyId: string) {
    return this.guests.list(requireOrgId(user), companyId);
  }

  @Post('companies/:companyId/guests')
  invite(
    @CurrentUser() user: AuthUser,
    @Param('companyId') companyId: string,
    @Body() body: InviteGuestInput,
  ) {
    return this.guests.invite(requireOrgId(user), user, companyId, body);
  }

  @Delete('company-guests/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.guests.revoke(requireOrgId(user), user, id);
  }
}
