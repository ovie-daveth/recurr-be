import type { Prisma } from "../generated/prisma/client";

type AdvisoryLockResult = Array<{ locked: boolean }>;

export function advisoryLockKey(scope: string, id: string) {
  return `recurr:${scope}:${id}`;
}

export async function tryAcquireTransactionAdvisoryLock(
  tx: Prisma.TransactionClient,
  key: string
) {
  const result = await tx.$queryRaw<AdvisoryLockResult>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked
  `;

  return Boolean(result[0]?.locked);
}
