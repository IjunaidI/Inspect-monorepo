/**
 * Prisma seed — Inspect MVP.
 *
 * Seeds the GLOBAL defect library (spec §7): a pre-classified, common-defect
 * catalogue (orgId = null, scope = GLOBAL) whose severities feed AQL directly.
 * Org-specific custom defects are added by QA Managers at runtime, not here.
 *
 * Idempotent: re-running only inserts globals that are missing (matched by name).
 *
 * Run with:  pnpm --filter @inspect/api exec prisma db seed
 *
 * NOTE: ISO 2859-1 Table I (code letters) and Table II-A (single-sampling Ac/Re)
 * are NOT seeded — they live as code/seed lookup constants in the AQL engine
 * (spec §8), not as database rows.
 */
import { PrismaClient, DefectScope, DefectSeverity } from '@prisma/client';

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
