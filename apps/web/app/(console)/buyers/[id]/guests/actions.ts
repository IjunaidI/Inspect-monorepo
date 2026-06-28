'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, apiDelete, ApiError } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

export const inviteBuyerGuest = async (
  buyerId: string,
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; data?: { token: string; expiresAt: string } }> => {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Email is required' };
  const expiresInDays = formData.get('expiresInDays');
  const body: Record<string, unknown> = { email };
  if (expiresInDays) body.expiresInDays = Number(expiresInDays);

  try {
    const res = await apiPost<{ token: string; expiresAt: string }>(
      `/buyers/${buyerId}/guests`,
      body,
    );
    revalidatePath(`/buyers/${buyerId}/guests`);
    return { data: res };
  } catch (e) {
    return { error: msg(e, 'Failed to create guest invitation') };
  }
};

export async function revokeBuyerGuest(buyerId: string, guestId: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/buyer-guests/${guestId}`);
  } catch (e) {
    return { error: msg(e, 'Failed to revoke guest') };
  }
  revalidatePath(`/buyers/${buyerId}/guests`);
  return {};
}
