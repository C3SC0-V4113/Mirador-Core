import type { PrismaClient } from '@prisma/client';

import { env } from '../../config/env.js';
import { validateReadonlySql } from './sql-safety.js';

export type ReadonlyQueryResult = {
  rows: unknown[];
  sourceViews: string[];
  validatedSql: string;
};

export async function runReadonlyQuery(
  prisma: PrismaClient,
  sql: string,
): Promise<ReadonlyQueryResult> {
  const validation = validateReadonlySql(sql);

  const rows = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `SET LOCAL statement_timeout = ${String(env.ANALYTICS_STATEMENT_TIMEOUT_MS)}`,
    );

    return transaction.$queryRawUnsafe<unknown[]>(validation.sql);
  });

  return {
    rows,
    sourceViews: validation.sourceViews,
    validatedSql: validation.sql,
  };
}
