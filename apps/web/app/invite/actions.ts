'use server';

import { redirect } from 'next/navigation';
import { apiPostPublic } from '@/lib/api';

export async function acceptInvitation(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string }> {
  const token = formData.get('token') as string;
  const name = (formData.get('name') as string)?.trim() || undefined;
  const password = formData.get('password') as string;

  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  try {
    await apiPostPublic('/invitations/accept', { token, name, password });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to accept invitation.' };
  }

  redirect('/login?invited=1');
}
