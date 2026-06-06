import { Module } from '@nestjs/common';
import { BuyersService } from './buyers.service';
import { BuyersController } from './buyers.controller';

@Module({
  providers: [BuyersService],
  controllers: [BuyersController],
  exports: [BuyersService],
})
export class BuyersModule {}
