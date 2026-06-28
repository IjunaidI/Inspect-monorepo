'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

export async function createPurchaseOrder(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const poNumber = String(formData.get('poNumber') ?? '').trim();
  if (!poNumber) return { error: 'PO number is required' };
  const buyerId = String(formData.get('buyerId') ?? '');
  const supplierId = String(formData.get('supplierId') ?? '');
  const productId = String(formData.get('productId') ?? '');
  const qty = formData.get('totalQuantity');
  const totalQuantity = qty ? Number(qty) : undefined;

  let id: string;
  try {
    const res = await apiPost<{ id: string }>('/purchase-orders', { poNumber, buyerId, supplierId, productId, totalQuantity });
    id = res.id;
  } catch (e) {
    return { error: msg(e, 'Failed to create purchase order') };
  }
  revalidatePath('/purchase-orders');
  redirect(`/purchase-orders/${id}`);
}

export async function updatePurchaseOrder(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const poNumber = String(formData.get('poNumber') ?? '').trim();
  if (!poNumber) return { error: 'PO number is required' };
  const qty = formData.get('totalQuantity');
  const totalQuantity = qty ? Number(qty) : undefined;

  try {
    await apiPatch(`/purchase-orders/${id}`, { poNumber, totalQuantity });
  } catch (e) {
    return { error: msg(e, 'Failed to update purchase order') };
  }
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${id}`);
  redirect(`/purchase-orders/${id}`);
}

export async function deletePurchaseOrder(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/purchase-orders/${id}`);
  } catch (e) {
    return { error: msg(e, 'Failed to delete purchase order') };
  }
  revalidatePath('/purchase-orders');
  redirect('/purchase-orders');
}
