import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Query,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from './product.entity';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getProducts(
    @Query('search') search?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedOffset =
      offset !== undefined && offset !== '' ? Number(offset) : 0;
    return this.productsService.getProducts(search || '', parsedOffset);
  }

  @Delete(':id')
  async deleteProduct(@Param('id', ParseIntPipe) id: number) {
    await this.productsService.deleteProduct(id);
    return { success: true };
  }

  @Post('seed')
  async seed(@Body() items: Partial<Product>[]) {
    return this.productsService.seed(items);
  }
}
