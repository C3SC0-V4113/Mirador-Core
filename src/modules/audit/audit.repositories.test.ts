import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { type AuditLogInput, createAuditRepository } from './audit.repositories.js';

function baseInput(): AuditLogInput {
  return {
    userId: 'user-1',
    clientType: 'WEB',
    path: '/api/chat/messages',
    question: '¿MRR del último mes?',
    metric: 'mrr',
    intentMode: null,
    answerSource: 'semantic',
    generatedSql: 'SELECT period_month, mrr FROM ceo_revenue_summary LIMIT 100',
    validatedSql: 'SELECT period_month, mrr FROM ceo_revenue_summary LIMIT 100',
    generatedSqlHash: 'hash-a',
    validatedSqlHash: 'hash-b',
    validationStatus: 'VALID',
    fallbackReason: null,
    missingMetricOrDimension: null,
    sourceViews: ['ceo_revenue_summary'],
    rowCount: 3,
    executionPlan: null,
    retrievedDocIds: [],
    latencyMs: 12,
    traceId: 'trace-1',
  };
}

describe('audit repository', () => {
  it('persists an audit row mapping all fields', async () => {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      queryAuditLog: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'audit-1' });
        },
      },
    } as unknown as PrismaClient;

    await createAuditRepository(prisma).insertAuditLog(baseInput());

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      clientType: 'WEB',
      metric: 'mrr',
      answerSource: 'semantic',
      validationStatus: 'VALID',
      sourceViews: ['ceo_revenue_summary'],
      rowCount: 3,
      traceId: 'trace-1',
    });
  });
});
