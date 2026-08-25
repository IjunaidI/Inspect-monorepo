import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { GuestService } from './guest.service';
import { Public } from '../auth/public.decorator';
import { guestRateLimit } from '../common/throttler.config';

/**
 * INS-047: per-IP throttle for the unauthenticated buyer-guest portal. Reads are
 * legitimately chattier than auth (a portal session opens a list plus several
 * reports), so this bucket is looser — but it still caps magic-link-token
 * guessing. Thunks, not literals: decorator metadata is frozen at import time,
 * before ConfigModule has loaded the repo-root .env into process.env.
 */
const guestThrottle = {
  public: {
    ttl: () => guestRateLimit().ttl,
    limit: () => guestRateLimit().limit,
  },
};

interface RequestLike {
  ip?: string;
  headers: Record<string, string | undefined>;
}

/**
 * Prefer the proxied client identity (the web portal forwards it) so the
 * ReportAccess audit row records the guest, not the web server.
 */
function clientOrigin(req: RequestLike): { ip?: string; userAgent?: string } {
  const forwarded = req?.headers?.['x-forwarded-for'];
  return {
    ip: forwarded ? forwarded.split(',')[0].trim() : req?.ip,
    userAgent: req?.headers?.['user-agent'],
  };
}

@Controller('guest')
export class GuestController {
  constructor(private readonly guest: GuestService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(guestThrottle)
  @Get('reports')
  list(@Query('token') token: string) {
    return this.guest.listReports(token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(guestThrottle)
  @Get('reports/:id')
  get(
    @Query('token') token: string,
    @Param('id') id: string,
    @Req() req: RequestLike,
  ) {
    const { ip, userAgent } = clientOrigin(req);
    return this.guest.getReport(token, id, ip, userAgent);
  }

  /**
   * INS-020 — presigned download of the report's branded PDF, recorded as a
   * DOWNLOAD access. Its own handler => its own throttle counter, so a buyer
   * downloading PDFs cannot exhaust their own report-reading budget.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(guestThrottle)
  @Get('reports/:id/pdf')
  pdf(
    @Query('token') token: string,
    @Param('id') id: string,
    @Req() req: RequestLike,
  ) {
    const { ip, userAgent } = clientOrigin(req);
    return this.guest.downloadReportPdf(token, id, ip, userAgent);
  }
}
