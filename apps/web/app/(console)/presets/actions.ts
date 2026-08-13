'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiPost, apiDelete, ApiError } from '@/lib/api';

/** INS-081: one ordered capture point taking exactly one image. */
export interface PresetItemInput {
  itemName: string;
  description?: string;
  referenceImageUrl?: string;
}

export interface CreatePresetInput {
  name: string;
  description?: string;
  aqlLevel?: string;
  items: PresetItemInput[];
  /** Loop-global (INS-081) — defined once for the whole loop, not per item. */
  measurementFields?: { label: string; unit?: string }[];
  allowedDefectCatalogIds?: string[];
}

const msg = (e: unknown, fb: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fb;

export async function createPreset(
  input: CreatePresetInput,
): Promise<{ error?: string }> {
  if (!input.name.trim()) return { error: 'Preset name is required' };
  if (!input.items.length) return { error: 'Add at least one loop item' };
  for (const it of input.items) {
    if (!it.itemName.trim()) return { error: 'Each loop item must have a name' };
  }
  try {
    await apiPost<{ id: string }>('/loop-presets', input);
  } catch (e) {
    return { error: msg(e, 'create failed') };
  }
  redirect('/presets');
}

export async function archivePreset(id: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/loop-presets/${id}`);
    revalidatePath('/presets');
    return {};
  } catch (e) {
    return { error: msg(e, 'archive failed') };
  }
}

/**
 * Presigned PUT for a loop-preset reference image (INS-052).
 * The client uploads the bytes directly to storage; only the returned
 * storageKey is submitted with the preset.
 */
export async function presignPresetImage(
  ext?: string,
): Promise<{ data?: { storageKey: string; uploadUrl: string }; error?: string }> {
  try {
    const data = await apiPost<{ storageKey: string; uploadUrl: string }>(
      '/loop-presets/presign',
      { ext },
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'presign failed') };
  }
}

export async function createDefect(
  name: string,
  defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR',
): Promise<{ data?: { id: string; name: string; defaultSeverity: string }; error?: string }> {
  if (!name.trim()) return { error: 'Defect name is required' };
  try {
    const d = await apiPost<{ id: string; name: string; defaultSeverity: string }>(
      '/defect-catalog',
      { name: name.trim(), defaultSeverity },
    );
    return { data: d };
  } catch (e) {
    return { error: msg(e, 'create defect failed') };
  }
}
