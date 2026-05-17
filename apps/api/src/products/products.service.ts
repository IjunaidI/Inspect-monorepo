import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Product } from './product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  async getProducts(
    search?: string,
    offset?: number,
  ): Promise<{
    products: Product[];
    newOffset: number | null;
    totalProducts: number;
  }> {
    if (search) {
      const products = await this.productsRepository.find({
        where: { name: ILike(`%${search}%`) },
        take: 1000,
      });
      return { products, newOffset: null, totalProducts: 0 };
    }

    if (offset === null || offset === undefined) {
      return { products: [], newOffset: null, totalProducts: 0 };
    }

    const totalProducts = await this.productsRepository.count();
    const products = await this.productsRepository.find({
      take: 5,
      skip: offset,
    });
    const newOffset = products.length >= 5 ? offset + 5 : null;

    return { products, newOffset, totalProducts };
  }

  async deleteProduct(id: number): Promise<void> {
    await this.productsRepository.delete(id);
  }

  async seed(items: Partial<Product>[]): Promise<Product[]> {
    const products = this.productsRepository.create(items);
    return this.productsRepository.save(products);
  }
}
