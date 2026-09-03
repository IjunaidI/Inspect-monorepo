'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';
import type { ApiCompany, ApiCompanyKind } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

/**
 * INS-055 — one set of company actions replaces the parallel buyer and supplier
 * sets. A company carries BOTH the branding fields (meaningful when it acts as a
 * client) and the address/GPS pair (meaningful when it acts as a factory);
 * neither is a role declaration, so one form writes both.
 */

/**
 * The company logo field (INS-072). The form submits the DURABLE value — an
 * object key minted by POST /companies/presign, or a legacy absolute URL carried
 * through untouched — never the short-lived presigned URL used for the preview.
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
 * The company GPS pair (INS-071). Structured numeric inputs replace the old
 * hand-typed JSON blob, whose JSON.parse sat in an EMPTY catch — a typo saved the
 * row with no coordinates and no error. Only the "half a pair" case is rejected
 * here (the API cannot tell it from a deliberate clear); everything else —
 * non-numeric, out of range — is the API's call, and its 400 message is what the
 * caller surfaces.
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

/** `kind` is sent verbatim; the API validates it against COMPANY_KINDS. */
function readKind(formData: FormData): string | undefined {
  return (formData.get('kind') as string) || undefined;
}

// ── Companies ───────────────────────────────────────────────────

export async function createCompany(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string }> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const logoUrl = readLogoUrl(formData);
  // Sent verbatim: the API validates /^#[0-9a-fA-F]{6}$/ and normalises case
  // (INS-077). Its 400 is the message the form shows — do not pre-filter it away.
  const primaryColor = (formData.get('primaryColor') as string) || undefined;
  const defaultLoopPresetId =
    (formData.get('defaultLoopPresetId') as string) || undefined;
  const address = (formData.get('address') as string) || undefined;
  const parsed = readGps(formData);
  if ('error' in parsed) return { error: parsed.error };
  let id: string;
  try {
    const c = await apiPost<{ id: string }>('/companies', {
      name,
      kind: readKind(formData),
      logoUrl,
      primaryColor,
      defaultLoopPresetId,
      address,
      gps: parsed.gps,
    });
    id = c.id;
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  revalidatePath('/dashboard');
  redirect(`/companies/${id}`);
}

export async function updateCompany(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name is required' };
  const logoUrl = readLogoUrl(formData);
  const primaryColor = (formData.get('primaryColor') as string) || undefined;
  const rawPreset = formData.get('defaultLoopPresetId') as string;
  const defaultLoopPresetId = rawPreset === '' ? null : rawPreset || undefined;
  const address = (formData.get('address') as string) || undefined;
  const parsed = readGps(formData);
  if ('error' in parsed) return { error: parsed.error };
  try {
    await apiPatch(`/companies/${id}`, {
      name,
      kind: readKind(formData),
      logoUrl,
      primaryColor,
      defaultLoopPresetId,
      address,
      gps: parsed.gps,
    });
  } catch (e) {
    return { error: msg(e, 'update failed') };
  }
  revalidatePath('/dashboard');
  revalidatePath(`/companies/${id}`);
  redirect(`/companies/${id}`);
}

/**
 * Presigned PUT for a company logo (INS-072), mirroring presignPresetImage.
 * The browser uploads the bytes straight to storage; only `storageKey` is ever
 * persisted on the company.
 */
export async function presignCompanyLogo(
  ext?: string,
): Promise<{
  data?: { storageKey: string; uploadUrl: string };
  error?: string;
}> {
  try {
    const data = await apiPost<{ storageKey: string; uploadUrl: string }>(
      '/companies/presign',
      { ext },
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'presign failed') };
  }
}

export async function archiveCompany(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/companies/${id}`);
  } catch (e) {
    return { error: msg(e, 'archive failed') };
  }
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function restoreCompany(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/companies/${id}/restore`);
  } catch (e) {
    return { error: msg(e, 'restore failed') };
  }
  revalidatePath('/dashboard');
  return {};
}

/**
 * INS-091 — quick-create from a picker. Returns the DTO instead of redirecting
 * (a redirect inside a modal would throw the host form away). Mirrors
 * `createDefect` in presets/actions.ts.
 */
export async function quickCreateCompany(input: {
  name: string;
  kind?: ApiCompanyKind;
}): Promise<{ data?: ApiCompany; error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: 'Name is required' };
  try {
    const data = await apiPost<ApiCompany>('/companies', { name, kind: input.kind });
    revalidatePath('/dashboard');
    return { data };
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
}
