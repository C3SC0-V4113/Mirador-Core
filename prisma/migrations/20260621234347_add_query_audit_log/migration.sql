-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('WEB', 'MCP');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('VALID', 'REJECTED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "query_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "client_type" "ClientType" NOT NULL,
    "path" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "metric" TEXT,
    "intent_mode" "IntentMode",
    "answer_source" TEXT,
    "generated_sql" TEXT,
    "validated_sql" TEXT,
    "generated_sql_hash" TEXT,
    "validated_sql_hash" TEXT,
    "validation_status" "ValidationStatus" NOT NULL,
    "fallback_reason" TEXT,
    "missing_metric_or_dimension" TEXT,
    "source_views" TEXT[],
    "row_count" INTEGER,
    "execution_plan" JSONB,
    "retrieved_doc_ids" TEXT[],
    "latency_ms" INTEGER,
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "query_audit_log_created_at_idx" ON "query_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "query_audit_log_trace_id_idx" ON "query_audit_log"("trace_id");
