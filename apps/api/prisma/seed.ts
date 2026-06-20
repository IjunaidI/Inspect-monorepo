/**
 * Prisma seed — Inspect MVP.
 *
 * Seeds the GLOBAL defect library (spec §7): a pre-classified, common-defect
 * catalogue (orgId = null, scope = GLOBAL) whose severities feed AQL directly.
 * Org-specific custom defects are added by QA Managers at runtime, not here.
 *
 * Idempotent: re-running only inserts globals that are missing (matched by name).
 *
 * Also (optional) bootstraps the FIRST Platform Admin when BOOTSTRAP_ADMIN_EMAIL +
 * BOOTSTRAP_ADMIN_PASSWORD are set — there is no in-app path to create one
 * (org creation is admin-only and users.service forbids assigning PLATFORM_ADMIN),
 * so the very first principal must be seeded. Idempotent (upsert by email).
 *
 * Run with:  pnpm --filter @inspect/api exec prisma db seed
 *
 * NOTE: ISO 2859-1 Table I (code letters) and Table II-A (single-sampling Ac/Re)
 * are NOT seeded — they live as code/seed lookup constants in the AQL engine
 * (spec §8), not as database rows.
 */
import { PrismaClient, DefectScope, DefectSeverity, UserRole, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/auth/password';

const prisma = new PrismaClient();

/** The editable starting set from spec §7. */
const GLOBAL_DEFECTS: Array<{ name: string; defaultSeverity: DefectSeverity }> = [
  // ── Critical — safety risk ────────────────────────────────────────────────
  { name: 'Sharp or broken needle', defaultSeverity: DefectSeverity.CRITICAL },
  { name: 'Metal contamination', defaultSeverity: DefectSeverity.CRITICAL },
  { name: 'Sharp point / object', defaultSeverity: DefectSeverity.CRITICAL },

  // ── Major ─────────────────────────────────────────────────────────────────
  { name: 'Skipped stitches', defaultSeverity: DefectSeverity.MAJOR },
  { name: 'Broken stitches', defaultSeverity: DefectSeverity.MAJOR },
  { name: 'Open or insecure seam', defaultSeverity: DefectSeverity.MAJOR },
  { name: 'Hole', defaultSeverity: DefectSeverity.MAJOR },
  { name: 'Stain', defaultSeverity: DefectSeverity.MAJOR },
  { name: 'Wrong or missing component', defaultSeverity: DefectSeverity.MAJOR },
  { name: 'Measurement out of agreed range', defaultSeverity: DefectSeverity.MAJOR },

  // ── Minor ───────────────────────────────────────────────────────────────
  { name: 'Loose threads', defaultSeverity: DefectSeverity.MINOR },
  { name: 'Slight shade variation', defaultSeverity: DefectSeverity.MINOR },
  { name: 'Minor puckering', defaultSeverity: DefectSeverity.MINOR },
  { name: 'Light surface marks', defaultSeverity: DefectSeverity.MINOR },
];

/**
 * Optional first-Platform-Admin bootstrap. No-op unless BOTH env vars are set.
 * Upsert by email → converges to a usable ACTIVE PLATFORM_ADMIN (orgId = null),
 * so re-running with a new password resets it. Reuses the tested scrypt hasher.
 */
async function seedBootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email && !password) return; // not requested (normal for prod seeds)
  if (!email || !password) {
    console.warn(
      'Bootstrap admin skipped: set BOTH BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.',
    );
    return;
  }
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Platform Admin';
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role: UserRole.PLATFORM_ADMIN,
      status: UserStatus.ACTIVE,
      orgId: null,
      passwordHash,
    },
    create: {
      email,
      name,
      role: UserRole.PLATFORM_ADMIN,
      status: UserStatus.ACTIVE,
      orgId: null,
      passwordHash,
    },
  });
  // eslint-disable-next-line no-console
  console.log(`Bootstrap Platform Admin ready: ${email} (PLATFORM_ADMIN, ACTIVE).`);
}

async function main(): Promise<void> {
  let created = 0;
  for (const defect of GLOBAL_DEFECTS) {
    // Match on (scope=GLOBAL, name); orgId is null for globals so a compound
    // upsert on [orgId, name] is unreliable (NULL != NULL) — use findFirst.
    const existing = await prisma.defectCatalog.findFirst({
      where: { scope: DefectScope.GLOBAL, name: defect.name },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.defectCatalog.create({
      data: {
        scope: DefectScope.GLOBAL,
        orgId: null,
        name: defect.name,
        defaultSeverity: defect.defaultSeverity,
      },
    });
    created += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seed complete: ${created} global defect(s) created, ` +
      `${GLOBAL_DEFECTS.length - created} already present.`,
  );

  await seedBootstrapAdmin();
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
