import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      /**
       * Prisma's defaults are `maxWait: 2000, timeout: 5000`, applied to every
       * interactive `$transaction` — 31 of them across this API, none of which
       * passes its own options.
       *
       * 5s is not enough against a non-local database. `inspections.submit()`
       * runs the AQL evaluation, the `AqlResult` write, the `BillableEvent`,
       * the status lock and a hash-chained `audit.append` inside ONE
       * transaction, and that append opens with a `pg_advisory_xact_lock` keyed
       * on the org (INS-012) — so concurrent same-org writers queue behind each
       * other while the clock runs. Add ~100ms of round-trip per statement and
       * the default is reached: the integration suite has produced
       * `P2028 Transaction already closed … 5292ms passed`, surfacing as a 500
       * on `POST /inspections/:id/submit`.
       *
       * The raised values keep the transaction bounded — a genuine hang still
       * fails, just not at the speed of the network. They do NOT relax any
       * invariant: the advisory lock, the append-only audit chain and the
       * per-org sequence all behave identically, they simply get time to
       * finish. Lower these only alongside making `submit()` do less work
       * inside the transaction.
       */
      transactionOptions: {
        maxWait: 5_000,
        timeout: 15_000,
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
