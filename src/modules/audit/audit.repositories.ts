import {
  type ClientType,
  type IntentMode,
  Prisma,
  type PrismaClient,
  type ValidationStatus,
} from '@prisma/client';

export type AuditLogInput = {
  userId: string | null;
  clientType: ClientType;
  path: string;
  question: string;
  metric: string | null;
  intentMode: IntentMode | null;
  answerSource: string | null;
  generatedSql: string | null;
  validatedSql: string | null;
  generatedSqlHash: string | null;
  validatedSqlHash: string | null;
  validationStatus: ValidationStatus;
  fallbackReason: string | null;
  missingMetricOrDimension: string | null;
  sourceViews: string[];
  rowCount: number | null;
  executionPlan: Prisma.InputJsonValue | null;
  retrievedDocIds: string[];
  latencyMs: number | null;
  traceId: string;
};

export type AuditRepository = {
  insertAuditLog(input: AuditLogInput): Promise<void>;
};

export function createAuditRepository(prisma: PrismaClient): AuditRepository {
  return {
    async insertAuditLog(input) {
      await prisma.queryAuditLog.create({
        data: {
          userId: input.userId,
          clientType: input.clientType,
          path: input.path,
          question: input.question,
          metric: input.metric,
          intentMode: input.intentMode,
          answerSource: input.answerSource,
          generatedSql: input.generatedSql,
          validatedSql: input.validatedSql,
          generatedSqlHash: input.generatedSqlHash,
          validatedSqlHash: input.validatedSqlHash,
          validationStatus: input.validationStatus,
          fallbackReason: input.fallbackReason,
          missingMetricOrDimension: input.missingMetricOrDimension,
          sourceViews: input.sourceViews,
          rowCount: input.rowCount,
          executionPlan: input.executionPlan ?? Prisma.JsonNull,
          retrievedDocIds: input.retrievedDocIds,
          latencyMs: input.latencyMs,
          traceId: input.traceId,
        },
      });
    },
  };
}
