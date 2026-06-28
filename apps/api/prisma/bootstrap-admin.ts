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
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@inspect.local';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'changeme123';
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
  console.log(`Platform admin ready: ${user.email} / ${password}`);
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
