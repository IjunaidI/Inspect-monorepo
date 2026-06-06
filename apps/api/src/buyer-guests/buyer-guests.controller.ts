import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { BuyerGuestsService, InviteGuestInput } from './buyer-guests.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

@Controller()
@Roles('QA_MANAGER')
export class BuyerGuestsController {
  constructor(private readonly guests: BuyerGuestsService) {}

  @Get('buyers/:buyerId/guests')
  list(@CurrentUser() user: AuthUser, @Param('buyerId') buyerId: string) {
    return this.guests.list(requireOrgId(user), buyerId);
  }

  @Post('buyers/:buyerId/guests')
  invite(
    @CurrentUser() user: AuthUser,
    @Param('buyerId') buyerId: string,
    @Body() body: InviteGuestInput,
  ) {
    return this.guests.invite(requireOrgId(user), buyerId, body);
  }

  @Delete('buyer-guests/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.guests.revoke(requireOrgId(user), id);
  }
}
