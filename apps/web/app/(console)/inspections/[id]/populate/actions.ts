'use server';

import {
  apiPost,
  apiDelete,
  ApiError,
  type PresignResult,
  type RegisterPhotoInput,
  type RetakePhotoInput,
  type AddDefectInput,
  type AddMeasurementInput,
  type ApiPhoto,
  type ApiDefectInstance,
  type ApiMeasurement,
} from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

export async function presignPhoto(
  inspectionId: string,
): Promise<{ data?: PresignResult; error?: string }> {
  try {
    const data = await apiPost<PresignResult>(
      `/inspections/${inspectionId}/populate/photos/presign`,
      {},
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'presign failed') };
  }
}

export async function registerPhoto(
  inspectionId: string,
  input: RegisterPhotoInput,
): Promise<{ data?: ApiPhoto; error?: string }> {
  try {
    const data = await apiPost<ApiPhoto>(
      `/inspections/${inspectionId}/populate/photos`,
      input,
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'register photo failed') };
  }
}

/**
 * INS-081: replace the bytes in an occupied slot. The photo id and its
 * (item, cycle) slot are unchanged — only the evidence behind them moves, and
 * the audit chain records both content hashes.
 */
export async function retakePhoto(
  inspectionId: string,
  photoId: string,
  input: RetakePhotoInput,
): Promise<{ data?: ApiPhoto; error?: string }> {
  try {
    const data = await apiPost<ApiPhoto>(
      `/inspections/${inspectionId}/populate/photos/${photoId}/retake`,
      input,
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'retake failed') };
  }
}

/** INS-081: discard a whole unit — the "remove" half of the end-of-loop rule. */
export async function discardCycle(
  inspectionId: string,
  cycleIndex: number,
): Promise<{ error?: string }> {
  try {
    await apiDelete(`/inspections/${inspectionId}/populate/cycles/${cycleIndex}`);
    return {};
  } catch (e) {
    return { error: msg(e, 'discard unit failed') };
  }
}

export async function addDefect(
  inspectionId: string,
  input: AddDefectInput,
): Promise<{ data?: ApiDefectInstance; error?: string }> {
  try {
    const data = await apiPost<ApiDefectInstance>(
      `/inspections/${inspectionId}/populate/defects`,
      input,
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'add defect failed') };
  }
}

export async function addMeasurement(
  inspectionId: string,
  input: AddMeasurementInput,
): Promise<{ data?: ApiMeasurement; error?: string }> {
  try {
    const data = await apiPost<ApiMeasurement>(
      `/inspections/${inspectionId}/populate/measurements`,
      input,
    );
    return { data };
  } catch (e) {
    return { error: msg(e, 'add measurement failed') };
  }
}
