'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiDelete, ApiError, type ApiInvitation } from '@/lib/api';

const msg = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

export async function inviteUser(
  _prev: unknown,
  formData: FormData,
): Promise<{
  error?: string;
  data?: { token: string; email: string; role: string; emailSent: boolean; expiresAt?: string };
}> {
  const email = (formData.get('email') as string)?.trim();
  const role = formData.get('role') as string;
  if (!email) return { error: 'Email is required' };

  try {
    const inv = await apiPost<ApiInvitation>('/users/invite', { email, role: role || 'INSPECTOR' });
    revalidatePath('/users');
    return {
      data: {
        token: inv.token,
        email: inv.email,
        role: inv.role,
        emailSent: inv.emailSent ?? false,
        expiresAt: inv.expiresAt,
      },
    };
  } catch (e) {
    return { error: msg(e, 'Failed to send invitation') };
  }
}

export async function updateUserRole(userId: string, role: string): Promise<{ error?: string }> {
  try {
    await apiPatch(`/users/${userId}/role`, { role });
  } catch (e) {
    return { error: msg(e, 'Failed to update role') };
  }
  revalidatePath('/users');
  return {};
}

export async function deactivateUser(userId: string): Promise<{ error?: string }> {
  try {
    await apiDelete(`/users/${userId}`);
  } catch (e) {
    return { error: msg(e, 'Failed to deactivate user') };
  }
  revalidatePath('/users');
  return {};
}
