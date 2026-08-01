'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

/**
 * The buyer logo field (INS-072). The form submits the DURABLE value — an object
 * key minted by POST /buyers/presign, or a legacy absolute URL carried through
 * untouched — never the short-lived presigned URL used for the preview.
 *   field absent  → undefined (leave as-is)
 *   present+empty → null      (explicit "remove logo")
 */
function readLogoUrl(formData: FormData): string | null | undefined {
  const raw = formData.get('logoUrl');
  if (raw === null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The supplier GPS pair (INS-071). Structured numeric inputs replace the old
 * hand-typed JSON blob, whose JSON.parse sat in an EMPTY catch — a typo saved the
 * supplier with no coordinates and no error. Only the "half a pair" case is
 * rejected here (the API cannot tell it from a deliberate clear); everything
 * else — non-numeric, out of range — is the API's call, and its 400 message is
 * what the caller surfaces.
 *   both blank → null (explicit clear)
 */
function readGps(
  formData: FormData,
): { gps: { lat: number; lng: number } | null } | { error: string } {
  const latRaw = String(formData.get('lat') ?? '').trim();
  const lngRaw = String(formData.get('lng') ?? '').trim();
  if (!latRaw && !lngRaw) return { gps: null };
  if (!latRaw || !lngRaw) {
    return { error: 'Enter both latitude and longitude, or clear both.' };
  }
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: 'Latitude and longitude must be numbers.' };
  }
  return { gps: { lat, lng } };
}

// ── Buyers ──────────────────────────────────────────────────────

export async function createBuyer(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const logoUrl = readLogoUrl(formData);
  // Sent verbatim: the API validates /^#[0-9a-fA-F]{6}$/ and normalises case
  // (INS-077). Its 400 is the message the form shows — do not pre-filter it away.
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
  const logoUrl = readLogoUrl(formData);
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

/**
 * Presigned PUT for a buyer logo (INS-072), mirroring presignPresetImage.
 * The browser uploads the bytes straight to storage; only `storageKey` is ever
 * persisted on the buyer.
 */
export async function presignBuyerLogo(
  ext?: string,
): Promise<{ data?: { storageKey: string; uploadUrl: string }; error?: string }> {
  try {
    const data = await apiPost<{ storageKey: string; uploadUrl: string }>('/buyers/presign', { ext });
    return { data };
  } catch (e) {
    return { error: msg(e, 'presign failed') };
  }
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
  const parsed = readGps(formData);
  if ('error' in parsed) return { error: parsed.error };
  let id: string;
  try {
    const s = await apiPost<{ id: string }>('/suppliers', { name, address, gps: parsed.gps });
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
  const parsed = readGps(formData);
  if ('error' in parsed) return { error: parsed.error };
  try {
    await apiPatch(`/suppliers/${id}`, { name, address, gps: parsed.gps });
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

export async function restoreBuyer(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/buyers/${id}/restore`);
  } catch (e) {
    return { error: msg(e, 'restore failed') };
  }
  revalidatePath('/dashboard');
  return {};
}

export async function restoreSupplier(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/suppliers/${id}/restore`);
  } catch (e) {
    return { error: msg(e, 'restore failed') };
  }
  revalidatePath('/dashboard');
  return {};
}
