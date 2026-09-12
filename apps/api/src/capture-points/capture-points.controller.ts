import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CAPTURE_POINT_CATEGORIES,
  type CapturePointCategory,
} from '@inspect/shared-types';
import {
  CapturePointsService,
  CreateCapturePointInput,
} from './capture-points.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { requireOrgId } from '../common/tenant';

/**
 * INS-097 — the capture-point library. Class floor `QA_MANAGER`, like
 * `/loop-presets`: authoring loops is a QA responsibility and inspectors never
 * see the builder. Reads are org-scoped by `requireOrgId` plus the global rows.
 */
@Controller('capture-points')
@Roles('QA_MANAGER')
export class CapturePointsController {
  constructor(private readonly points: CapturePointsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query()
    query: { q?: string; category?: string; includeArchived?: string },
  ) {
    let category: CapturePointCategory | undefined;
    if (query.category) {
      if (
        !CAPTURE_POINT_CATEGORIES.includes(
          query.category as CapturePointCategory,
        )
      ) {
        throw new BadRequestException(
          `category must be one of ${CAPTURE_POINT_CATEGORIES.join(', ')}`,
        );
      }
      category = query.category as CapturePointCategory;
    }
    return this.points.list(requireOrgId(user), {
      q: query.q?.trim() || undefined,
      category,
      includeArchived: query.includeArchived === '1',
    });
  }

  /** Find-or-create by folded name — a duplicate returns the existing row (global or org). */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateCapturePointInput) {
    return this.points.findOrCreate(requireOrgId(user), user, body);
  }

  @Delete(':id')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.points.archive(requireOrgId(user), user, id);
  }
}
