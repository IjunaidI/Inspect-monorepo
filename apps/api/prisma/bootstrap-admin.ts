/**
 * One-off local-dev bootstrap: creates the very first PLATFORM_ADMIN user.
 * There is no public signup endpoint by design (invite-only onboarding) — this
 * script is the only way to seed the first principal. Idempotent (upsert by email).
 *
 * Run with: pnpm --filter @inspect/api exec ts-node --transpile-only prisma/bootstrap-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Fail closed (INS-053): no default credentials — this script writes the sole
  // cross-tenant principal into whatever DATABASE_URL points at.
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    // eslint-disable-next-line no-console
    console.error(
      'Refusing to run: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD explicitly.',
    );
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'PLATFORM_ADMIN', orgId: null, status: 'ACTIVE' },
    create: {
      email,
      name: 'Platform Admin',
      role: 'PLATFORM_ADMIN',
      orgId: null,
      status: 'ACTIVE',
      passwordHash,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Platform admin ready: ${user.email} (password from BOOTSTRAP_ADMIN_PASSWORD)`);
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
