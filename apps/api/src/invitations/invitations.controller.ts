import { Body, Controller, Post } from '@nestjs/common';
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
}
