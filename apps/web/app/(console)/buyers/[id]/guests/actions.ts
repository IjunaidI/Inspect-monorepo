'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, apiDelete, ApiError, type ApiBuyerGuest } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

export const inviteBuyerGuest = async (
  buyerId: string,
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; data?: { token: string; expiresAt: string; emailSent: boolean } }> => {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Email is required' };
  // The API's InviteGuestInput reads `ttlDays` — the form field is named
  // `expiresInDays` for the UI copy, but must be sent under the API's name.
  const expiresInDays = formData.get('expiresInDays');
  const body: Record<string, unknown> = { email };
  if (expiresInDays) body.ttlDays = Number(expiresInDays);

  try {
    const res = await apiPost<{ guest: ApiBuyerGuest; token: string; emailSent: boolean }>(
      `/buyers/${buyerId}/guests`,
      body,
    );
    revalidatePath(`/buyers/${buyerId}/guests`);
    return {
      data: { token: res.token, expiresAt: res.guest.tokenExpiresAt, emailSent: res.emailSent },
    };
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
