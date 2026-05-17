import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'image_url', type: 'text' })
  imageUrl: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'enum', enum: ['active', 'inactive', 'archived'] })
  status: 'active' | 'inactive' | 'archived';

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: string;

  @Column({ type: 'integer' })
  stock: number;

  @Column({ name: 'available_at', type: 'timestamp' })
  availableAt: Date;
}
