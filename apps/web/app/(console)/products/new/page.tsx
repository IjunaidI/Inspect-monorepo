import { PageHead } from '@/components/inspect/shell';
import { CreateProductForm } from './create-form';

export default function NewProductPage() {
  return (
    <div style={{ padding: '24px 32px 40px' }}>
      <PageHead title="Add Product" sub="Create a new style/SKU for use in purchase orders." />
      <CreateProductForm />
    </div>
  );
}
