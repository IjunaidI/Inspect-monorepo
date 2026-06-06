import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { InviteUserInput, UsersService } from './users.service';
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
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(requireOrgId(user));
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

  @Delete(':id')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(requireOrgId(user), id);
  }
}
