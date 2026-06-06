import { Module } from '@nestjs/common';
import { DefectCatalogService } from './defect-catalog.service';
import { DefectCatalogController } from './defect-catalog.controller';

@Module({
  providers: [DefectCatalogService],
  controllers: [DefectCatalogController],
  exports: [DefectCatalogService],
})
export class DefectCatalogModule {}
