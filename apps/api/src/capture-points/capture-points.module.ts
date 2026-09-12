import { Module } from '@nestjs/common';
import { CapturePointsService } from './capture-points.service';
import { CapturePointsController } from './capture-points.controller';

@Module({
  providers: [CapturePointsService],
  controllers: [CapturePointsController],
  exports: [CapturePointsService],
})
export class CapturePointsModule {}
