import { Module } from '@nestjs/common';
import { PopulateService } from './populate.service';
import { PopulateController } from './populate.controller';

@Module({
  providers: [PopulateService],
  controllers: [PopulateController],
})
export class PopulateModule {}
