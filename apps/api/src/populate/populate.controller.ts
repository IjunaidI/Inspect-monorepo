import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  AddDefectInput,
  AddMeasurementInput,
  PopulateService,
  PresignInput,
  RegisterPhotoInput,
} from './populate.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';

/**
 * The Admin populate console (spec §1/§4): in MVP the Platform Admin owns the
 * entire populate step. orgId is derived from the target inspection, not the
 * caller (the Platform Admin is cross-tenant, orgId=null).
 *
 * Idempotency (INS-016): `clientRequestId` on POST photos/defects is scoped to
 * ONE inspection. Replaying it against the same inspection returns the original
 * row (2xx); reusing it against a different inspection is a **409 Conflict**.
 * See `PopulateService.replayOrConflict` for the full contract.
 */
@Controller('inspections/:inspectionId/populate')
@Roles('PLATFORM_ADMIN')
export class PopulateController {
  constructor(private readonly populate: PopulateService) {}

  @Get()
  load(@Param('inspectionId') inspectionId: string) {
    return this.populate.loadForPopulate(inspectionId);
  }

  @Post('photos/presign')
  presign(@Param('inspectionId') inspectionId: string, @Body() body: PresignInput) {
    return this.populate.presignPhotoUpload(inspectionId, body ?? {});
  }

  @Post('photos')
  register(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Body() body: RegisterPhotoInput,
  ) {
    return this.populate.registerPhoto(inspectionId, user, body);
  }

  @Patch('photos/:photoId/loop')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Param('photoId') photoId: string,
    @Body() body: { inspectionLoopId: string },
  ) {
    return this.populate.assignPhotoToLoop(inspectionId, user, photoId, body?.inspectionLoopId);
  }

  @Post('defects')
  addDefect(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Body() body: AddDefectInput,
  ) {
    return this.populate.addDefect(inspectionId, user, body);
  }

  @Post('measurements')
  addMeasurement(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Body() body: AddMeasurementInput,
  ) {
    return this.populate.addMeasurement(inspectionId, user, body);
  }
}
