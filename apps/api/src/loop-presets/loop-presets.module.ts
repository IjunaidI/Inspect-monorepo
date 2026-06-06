import { Module } from '@nestjs/common';
import { LoopPresetsService } from './loop-presets.service';
import { LoopPresetsController } from './loop-presets.controller';

@Module({
  providers: [LoopPresetsService],
  controllers: [LoopPresetsController],
  exports: [LoopPresetsService],
})
export class LoopPresetsModule {}
