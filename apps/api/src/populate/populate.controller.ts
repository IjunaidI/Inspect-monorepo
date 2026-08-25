import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  AddDefectInput,
  AddMeasurementInput,
  PopulateService,
  PresignInput,
  RegisterPhotoInput,
  RetakePhotoInput,
} from './populate.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth-user';

/**
 * The populate console (spec §1/§4) — the evidence-capture step.
 *
 * INS-083: the floor is `INSPECTOR`, not `PLATFORM_ADMIN`. Capture is the one
 * job that belongs to the person physically holding the garment, and the mobile
 * app (INS-086) has no Platform Admin mode at all, so an admin-only populate
 * would make the app pointless. Widening the floor is only half of it — the
 * row-level scope lives in `PopulateService.scopeFor`, which confines an
 * INSPECTOR to inspections assigned to them and any org role to its own org,
 * while the Platform Admin stays cross-tenant. Without that scope this floor
 * would be a cross-tenant hole, because the lookup used to be a bare
 * `findUnique(id)` that was safe only while the sole caller was cross-tenant.
 *
 * orgId is still derived from the target inspection, never from the caller
 * (the Platform Admin is cross-tenant, orgId=null).
 *
 * Idempotency (INS-016): `clientRequestId` on POST photos/defects is scoped to
 * ONE inspection. Replaying it against the same inspection returns the original
 * row (2xx); reusing it against a different inspection is a **409 Conflict**.
 * See `PopulateService.replayOrConflict` for the full contract.
 */
@Controller('inspections/:inspectionId/populate')
@Roles('INSPECTOR')
export class PopulateController {
  constructor(private readonly populate: PopulateService) {}

  @Get()
  load(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
  ) {
    return this.populate.loadForPopulate(inspectionId, user);
  }

  @Post('photos/presign')
  presign(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Body() body: PresignInput,
  ) {
    return this.populate.presignPhotoUpload(inspectionId, user, body ?? {});
  }

  @Post('photos')
  register(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Body() body: RegisterPhotoInput,
  ) {
    return this.populate.registerPhoto(inspectionId, user, body);
  }

  /** INS-081: replace the bytes in an occupied slot. Pre-submit only. */
  @Post('photos/:photoId/retake')
  retake(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Param('photoId') photoId: string,
    @Body() body: RetakePhotoInput,
  ) {
    return this.populate.retakePhoto(inspectionId, user, photoId, body);
  }

  /** INS-081: discard a whole unit — the "remove" half of the end-of-loop rule. */
  @Delete('cycles/:cycleIndex')
  discardCycle(
    @CurrentUser() user: AuthUser,
    @Param('inspectionId') inspectionId: string,
    @Param('cycleIndex') cycleIndex: string,
  ) {
    return this.populate.discardCycle(inspectionId, user, Number(cycleIndex));
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
