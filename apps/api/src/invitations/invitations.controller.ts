import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AcceptInvitationInput, InvitationsService } from './invitations.service';
import { Public } from '../auth/public.decorator';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Post('accept')
  accept(@Body() body: AcceptInvitationInput) {
    return this.invitations.accept(body);
  }

  // NOTE: keep AFTER the static 'accept' route so it never shadows it.
  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.invitations.getByToken(token);
  }
}
