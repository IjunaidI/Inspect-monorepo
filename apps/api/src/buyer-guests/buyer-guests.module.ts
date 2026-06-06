import { Module } from '@nestjs/common';
import { BuyerGuestsService } from './buyer-guests.service';
import { BuyerGuestsController } from './buyer-guests.controller';

@Module({
  providers: [BuyerGuestsService],
  controllers: [BuyerGuestsController],
  exports: [BuyerGuestsService],
})
export class BuyerGuestsModule {}
