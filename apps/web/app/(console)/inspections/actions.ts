'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiGet, apiPost, ApiError, type AqlPreview } from '@/lib/api';

const msg = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

export async function previewAql(input: { lotSize: number; critical?: number; major?: number; minor?: number }): Promise<{ data?: AqlPreview; error?: string }> {
  if (!Number.isFinite(input.lotSize) || input.lotSize < 2) return { error: 'Enter a lot size of 2 or more' };
  const q = new URLSearchParams({ lotSize: String(Math.trunc(input.lotSize)) });
  if (input.critical != null) q.set('critical', String(input.critical));
  if (input.major != null) q.set('major', String(input.major));
  if (input.minor != null) q.set('minor', String(input.minor));
  try {
    return { data: await apiGet<AqlPreview>(`/inspections/aql-preview?${q.toString()}`) };
  } catch (e) {
    return { error: msg(e, 'preview failed') };
  }
}

export async function createInspection(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const poId = String(formData.get('poId') ?? '');
  const loopPresetId = String(formData.get('loopPresetId') ?? '');
  const lotSize = Number(formData.get('lotSize'));
  const assignedInspectorId = (formData.get('assignedInspectorId') as string) || undefined;
  const clientRequestId = (formData.get('clientRequestId') as string) || undefined;
  if (!poId) return { error: 'Select a purchase order' };
  if (!loopPresetId) return { error: 'Select a loop preset' };
  if (!Number.isFinite(lotSize) || lotSize < 2) return { error: 'Enter a lot size of 2 or more' };
  let id: string;
  try {
    const insp = await apiPost<{ id: string }>('/inspections', { poId, loopPresetId, lotSize, assignedInspectorId, clientRequestId });
    id = insp.id;
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  redirect(`/inspections/${id}/review`);
}

export async function submitInspection(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/inspections/${id}/submit`, { deviceId: 'web-console' });
    revalidatePath(`/inspections/${id}/review`);
    return {};
  } catch (e) {
    return { error: msg(e, 'submit failed') };
  }
}

export async function decideInspection(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const id = String(formData.get('id') ?? '');
  const decision = String(formData.get('decision') ?? '') as 'PASS' | 'FAIL' | 'HOLD';
  const remarks = String(formData.get('remarks') ?? '');
  if (!decision) return { error: 'Select a decision' };
  if (!remarks.trim()) return { error: 'A decision note is required' };
  try {
    await apiPost(`/inspections/${id}/decision`, { decision, remarks });
    revalidatePath(`/inspections/${id}/review`);
    return {};
  } catch (e) {
    return { error: msg(e, 'decision failed') };
  }
}
