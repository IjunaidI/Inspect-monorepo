'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

// ── Buyers ──────────────────────────────────────────────────────

export async function createBuyer(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const logoUrl = (formData.get('logoUrl') as string) || undefined;
  const primaryColor = (formData.get('primaryColor') as string) || undefined;
  const defaultLoopPresetId = (formData.get('defaultLoopPresetId') as string) || undefined;
  let id: string;
  try {
    const b = await apiPost<{ id: string }>('/buyers', { name, logoUrl, primaryColor, defaultLoopPresetId });
    id = b.id;
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  revalidatePath('/dashboard');
  redirect(`/buyers/${id}`);
}

export async function updateBuyer(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const logoUrl = (formData.get('logoUrl') as string) || undefined;
  const primaryColor = (formData.get('primaryColor') as string) || undefined;
  const rawPreset = formData.get('defaultLoopPresetId') as string;
  const defaultLoopPresetId = rawPreset === '' ? null : rawPreset || undefined;
  try {
    await apiPatch(`/buyers/${id}`, { name, logoUrl, primaryColor, defaultLoopPresetId });
  } catch (e) {
    return { error: msg(e, 'update failed') };
  }
  revalidatePath('/dashboard');
  revalidatePath(`/buyers/${id}`);
  redirect(`/buyers/${id}`);
}

export async function archiveBuyer(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/buyers/${id}`);
  } catch (e) {
    return { error: msg(e, 'archive failed') };
  }
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

// ── Suppliers ──────────────────────────────────────────────────

export async function createSupplier(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const address = (formData.get('address') as string) || undefined;
  const gpsJson = (formData.get('gpsJson') as string) || '';
  let gps: { lat: number; lng: number } | undefined;
  if (gpsJson.trim()) {
    try { gps = JSON.parse(gpsJson) as { lat: number; lng: number }; } catch { /* ignore invalid JSON */ }
  }
  let id: string;
  try {
    const s = await apiPost<{ id: string }>('/suppliers', { name, address, gps });
    id = s.id;
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  revalidatePath('/dashboard');
  redirect(`/suppliers/${id}`);
}

export async function updateSupplier(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const address = (formData.get('address') as string) || undefined;
  const gpsJson = (formData.get('gpsJson') as string) || '';
  let gps: { lat: number; lng: number } | undefined;
  if (gpsJson.trim()) {
    try { gps = JSON.parse(gpsJson) as { lat: number; lng: number }; } catch { /* ignore invalid JSON */ }
  }
  try {
    await apiPatch(`/suppliers/${id}`, { name, address, gps });
  } catch (e) {
    return { error: msg(e, 'update failed') };
  }
  revalidatePath('/dashboard');
  revalidatePath(`/suppliers/${id}`);
  redirect(`/suppliers/${id}`);
}

export async function archiveSupplier(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/suppliers/${id}`);
  } catch (e) {
    return { error: msg(e, 'archive failed') };
  }
  revalidatePath('/dashboard');
  redirect('/dashboard');
}
