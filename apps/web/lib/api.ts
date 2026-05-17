import 'server-only';

const API_URL = process.env.API_URL || 'http://localhost:3000';

export interface Product {
  id: number;
  imageUrl: string;
  name: string;
  status: 'active' | 'inactive' | 'archived';
  price: string;
  stock: number;
  availableAt: string;
}

export async function getProducts(
  search: string,
  offset: number,
): Promise<{
  products: Product[];
  newOffset: number | null;
  totalProducts: number;
}> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  params.set('offset', String(offset));

  const res = await fetch(`${API_URL}/products?${params}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch products: ${res.status}`);
  }
  return res.json();
}

export async function deleteProductById(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Failed to delete product: ${res.status}`);
  }
}
