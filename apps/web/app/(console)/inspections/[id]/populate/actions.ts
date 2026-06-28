'use server';

import { apiPost, apiPatch, ApiError, type PresignResult, type RegisterPhotoInput, type AddDefectInput, type AddMeasurementInput, type ApiPhoto, type ApiDefectInstance, type ApiMeasurement } from '@/lib/api';

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

export async function assignPhotoToLoop(
  inspectionId: string,
  photoId: string,
  inspectionLoopId: string,
): Promise<{ error?: string }> {
  try {
    await apiPatch(
      `/inspections/${inspectionId}/populate/photos/${photoId}/loop`,
      { inspectionLoopId },
    );
    return {};
  } catch (e) {
    return { error: msg(e, 'assign photo failed') };
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
