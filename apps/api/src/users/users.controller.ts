import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InviteUserInput, UsersService } from './users.service';
import { parseListQuery, RawListQuery } from '../common/list-query';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/rbac';
import { requireOrgId } from '../common/tenant';

@Controller('users')
@Roles('ORG_OWNER')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: RawListQuery) {
    return this.users.list(requireOrgId(user), parseListQuery(query));
  }

  @Post('invite')
  invite(@CurrentUser() user: AuthUser, @Body() body: InviteUserInput) {
    return this.users.invite(requireOrgId(user), user, body);
  }

  @Patch(':id/role')
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { role: Role },
  ) {
    return this.users.updateRole(requireOrgId(user), user, id, body?.role);
  }

  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.reactivate(requireOrgId(user), user, id);
  }

  @Delete(':id')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(requireOrgId(user), user, id);
  }
}
