'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

export async function createProduct(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const styleNumber = String(formData.get('styleNumber') ?? '').trim();
  if (!styleNumber) return { error: 'Style number is required' };
  const description = (formData.get('description') as string) || undefined;
  let id: string;
  try {
    const res = await apiPost<{ id: string }>('/products', { styleNumber, description });
    id = res.id;
  } catch (e) {
    return { error: msg(e, 'Failed to create product') };
  }
  revalidatePath('/products');
  redirect(`/products/${id}`);
}

export async function updateProduct(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const styleNumber = String(formData.get('styleNumber') ?? '').trim();
  if (!styleNumber) return { error: 'Style number is required' };
  const description = (formData.get('description') as string) || undefined;
  try {
    await apiPatch(`/products/${id}`, { styleNumber, description });
  } catch (e) {
    return { error: msg(e, 'Failed to update product') };
  }
  revalidatePath('/products');
  revalidatePath(`/products/${id}`);
  redirect(`/products/${id}`);
}

export async function archiveProduct(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/products/${id}`);
  } catch (e) {
    return { error: msg(e, 'Failed to archive product') };
  }
  revalidatePath('/products');
  redirect('/products');
}
