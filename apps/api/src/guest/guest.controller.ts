import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { GuestService } from './guest.service';
import { Public } from '../auth/public.decorator';

interface RequestLike {
  ip?: string;
  headers: Record<string, string | undefined>;
}

@Controller('guest')
export class GuestController {
  constructor(private readonly guest: GuestService) {}

  @Public()
  @Get('reports')
  list(@Query('token') token: string) {
    return this.guest.listReports(token);
  }

  @Public()
  @Get('reports/:id')
  get(
    @Query('token') token: string,
    @Param('id') id: string,
    @Req() req: RequestLike,
  ) {
    return this.guest.getReport(token, id, req?.ip, req?.headers?.['user-agent']);
  }
}
