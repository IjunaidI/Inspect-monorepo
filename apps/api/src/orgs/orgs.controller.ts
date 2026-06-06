import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateOrgInput, OrgsService } from './orgs.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';

@Controller('admin/orgs')
@Roles('PLATFORM_ADMIN')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list() {
    return this.orgs.list();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateOrgInput) {
    return this.orgs.create(user.userId, body);
  }
}
