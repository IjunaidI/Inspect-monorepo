import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  AcceptInvitationInput,
  InvitationsService,
} from './invitations.service';
import { Public } from '../auth/public.decorator';
import { inviteRateLimit } from '../common/throttler.config';

/**
 * INS-047: per-IP throttle for the unauthenticated invitation surface — this is
 * the token-guessing (INS-037) and account-enumeration (INS-042) attack surface.
 * The guard keys on controller+handler, so accept and the public lookup each get
 * their own budget. Thunks, not literals: decorator metadata is frozen at import
 * time, before ConfigModule has loaded the repo-root .env into process.env.
 */
const inviteThrottle = {
  public: {
    ttl: () => inviteRateLimit().ttl,
    limit: () => inviteRateLimit().limit,
  },
};

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(inviteThrottle)
  @Post('accept')
  accept(@Body() body: AcceptInvitationInput) {
    return this.invitations.accept(body);
  }

  // NOTE: keep AFTER the static 'accept' route so it never shadows it.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(inviteThrottle)
  @Get(':token')
  get(@Param('token') token: string) {
    return this.invitations.getByToken(token);
  }
}
