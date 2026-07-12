import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';
import { parseListQuery } from '../common/list-query';

@Controller('search')
@Roles('QA_MANAGER')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    const { q: cleaned } = parseListQuery({ q });
    return this.search.search(requireOrgId(user), cleaned);
  }
}
