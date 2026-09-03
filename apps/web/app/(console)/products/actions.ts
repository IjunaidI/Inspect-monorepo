'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';
import type { ApiProduct } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

/**
 * INS-074: an emptied textarea must CLEAR the column, so it has to reach the
 * API as an explicit `null` — `undefined` drops the key from the JSON body and
 * Prisma reads that as "leave unchanged", which made a description permanently
 * un-clearable from the console.
 */
function descriptionField(formData: FormData): string | null {
  const raw = formData.get('description');
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return raw;
}

export async function createProduct(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const styleNumber = String(formData.get('styleNumber') ?? '').trim();
  if (!styleNumber) return { error: 'Style number is required' };
  const description = descriptionField(formData);
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
  const description = descriptionField(formData);
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

/** INS-091 — quick-create from a picker; returns the DTO, never redirects. */
export async function quickCreateProduct(input: {
  styleNumber: string;
  description?: string | null;
}): Promise<{ data?: ApiProduct; error?: string }> {
  const styleNumber = input.styleNumber.trim();
  if (!styleNumber) return { error: 'Style number is required' };
  const description =
    typeof input.description === 'string' && input.description.trim().length > 0 ? input.description : null;
  try {
    const data = await apiPost<ApiProduct>('/products', { styleNumber, description });
    revalidatePath('/products');
    return { data };
  } catch (e) {
    return { error: msg(e, 'Failed to create product') };
  }
}
