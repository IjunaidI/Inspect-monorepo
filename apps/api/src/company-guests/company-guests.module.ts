import { Module } from '@nestjs/common';
import { CompanyGuestsService } from './company-guests.service';
import { CompanyGuestsController } from './company-guests.controller';

@Module({
  providers: [CompanyGuestsService],
  controllers: [CompanyGuestsController],
  exports: [CompanyGuestsService],
})
export class CompanyGuestsModule {}
