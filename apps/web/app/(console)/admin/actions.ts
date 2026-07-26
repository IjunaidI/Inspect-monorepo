'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { apiGet, apiPost, ApiError, type ApiCreatedOrg, type ApiOrganization } from '@/lib/api';
import { setAssumedOrgId, clearAssumedOrgId } from '@/lib/admin-org';

async function requirePlatformAdmin(): Promise<void> {
  const session = (await auth()) as unknown as { role?: string } | null;
  if (session?.role !== 'PLATFORM_ADMIN') {
    throw new Error('Platform Admin only');
  }
}

export type CreateOrgState = {
  ok: boolean;
  error?: string;
  created?: { orgName: string; email: string; token: string; emailSent: boolean };
};

export async function createOrg(
  _prev: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  await requirePlatformAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? 'INSPECTION_COMPANY');
  const ownerEmail = String(formData.get('ownerEmail') ?? '').trim();
  if (!name || !ownerEmail) {
    return { ok: false, error: 'Organization name and owner email are both required.' };
  }
  try {
    const res = await apiPost<ApiCreatedOrg>('/admin/orgs', { name, type, ownerEmail });
    revalidatePath('/admin/orgs');
    return {
      ok: true,
      created: {
        orgName: res.org.name,
        email: res.invitation.email,
        token: res.invitation.token,
        emailSent: res.emailSent,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Could not create the organization.' };
  }
}

/** Enter an org's workspace. Validates the id once, here — the guard trusts it per request. */
export async function enterOrg(orgId: string): Promise<void> {
  await requirePlatformAdmin();
  const orgs = await apiGet<ApiOrganization[]>('/admin/orgs');
  if (!orgs.some((o) => o.id === orgId)) {
    throw new Error('Unknown organization');
  }
  await setAssumedOrgId(orgId);
  redirect('/dashboard');
}

export async function exitOrg(): Promise<void> {
  await clearAssumedOrgId();
  redirect('/admin/orgs');
}
