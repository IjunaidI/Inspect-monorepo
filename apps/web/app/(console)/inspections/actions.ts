'use server';

import { redirect } from 'next/navigation';
import type { QaDecision } from '@inspect/shared-types';
import { revalidatePath } from 'next/cache';
import { apiGet, apiPost, apiPatch, ApiError, type AqlPreview, type ApiInspection } from '@/lib/api';

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

/**
 * INS-063 — the per-class AQLs picked on the create form, as they arrive in the
 * FormData. A field that is absent/blank means "let the API apply the spec
 * default"; a present-but-unparseable one is an error we must NOT forward,
 * because `JSON.stringify(NaN)` is `null` and the API reads null as "omitted" —
 * a bad value would silently become the default AQL instead of being rejected.
 * The allowed SET is deliberately not duplicated here: the API derives it from
 * the verified Z1.4 grid and is the authority, and its 400 message names the
 * accepted values verbatim (surfaced below as the form error).
 */
const AQL_FIELDS = [
  ['aqlCritical', 'critical'],
  ['aqlMajor', 'major'],
  ['aqlMinor', 'minor'],
] as const;

function readAqlPlan(formData: FormData): { plan?: Record<string, number>; error?: string } {
  const plan: Record<string, number> = {};
  for (const [fieldName, cls] of AQL_FIELDS) {
    const raw = formData.get(fieldName);
    if (raw === null || String(raw).trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return { error: `Choose a valid ${cls} AQL` };
    plan[cls] = value;
  }
  return { plan: Object.keys(plan).length > 0 ? plan : undefined };
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
  const aql = readAqlPlan(formData);
  if (aql.error) return { error: aql.error };
  let id: string;
  try {
    const insp = await apiPost<{ id: string }>('/inspections', { poId, loopPresetId, lotSize, aqlPlan: aql.plan, assignedInspectorId, clientRequestId });
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
  const decision = String(formData.get('decision') ?? '') as QaDecision;
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

export async function reInspection(id: string): Promise<{ error?: string }> {
  let orig: ApiInspection;
  try {
    orig = await apiGet<ApiInspection>(`/inspections/${id}`);
  } catch (e) {
    return { error: msg(e, 'could not load original inspection') };
  }
  const poId = orig.purchaseOrder?.id;
  if (!poId) return { error: 'No purchase order on original inspection' };
  const snapshot = (orig as unknown as Record<string, unknown>);
  const loopPresetId = (snapshot.loopPresetId as string | undefined) ??
    ((snapshot.loopPresetSnapshot as Record<string, unknown> | null)?.id as string | undefined);
  // INS-063: carry the ORIGINAL inspection's per-class AQL plan across. A
  // re-inspection is a correction of the same lot against the same buyer
  // agreement — silently reverting it to the spec defaults would change the
  // acceptance numbers behind the QA Manager's back.
  const aqlPlan = snapshot.aqlPlan as Record<string, number> | null | undefined;
  let newId: string;
  try {
    const created = await apiPost<{ id: string }>('/inspections', {
      poId,
      ...(loopPresetId ? { loopPresetId } : {}),
      lotSize: orig.lotSize,
      ...(aqlPlan ? { aqlPlan } : {}),
      supersedesInspectionId: id,
    });
    newId = created.id;
  } catch (e) {
    return { error: msg(e, 're-inspection create failed') };
  }
  redirect(`/inspections/${newId}/review`);
}

export async function startInspection(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/inspections/${id}/start`);
  } catch (e) {
    return { error: msg(e, 'start failed') };
  }
  revalidatePath('/inspections');
  return {};
}

export async function resetInspection(id: string): Promise<{ error?: string }> {
  try {
    await apiPost(`/inspections/${id}/reset`);
  } catch (e) {
    return { error: msg(e, 'reset failed') };
  }
  revalidatePath('/inspections');
  return {};
}

export async function reassignInspection(id: string, inspectorId: string): Promise<{ error?: string }> {
  try {
    await apiPatch(`/inspections/${id}`, { assignedInspectorId: inspectorId });
  } catch (e) {
    return { error: msg(e, 'reassign failed') };
  }
  revalidatePath('/inspections');
  return {};
}
