-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('TEXT', 'TABLE', 'KPI', 'CHART', 'REPORT', 'ACTION_PLAN');

-- CreateEnum
CREATE TYPE "IntentMode" AS ENUM ('RESPONDER', 'ANALIZAR', 'REPORTE_VISUAL', 'PLAN');

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" "ChatRole" NOT NULL,
    "intent_mode" "IntentMode",
    "content" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "artifact_type" "ArtifactType" NOT NULL,
    "question" TEXT NOT NULL,
    "period" TEXT,
    "source_views" TEXT[],
    "validated_sql" TEXT,
    "summary" TEXT,
    "payload" JSONB NOT NULL,
    "chart_spec" JSONB,
    "freshness" TEXT,
    "warnings" TEXT[],
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_idx" ON "chat_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "chat_artifacts_conversation_id_idx" ON "chat_artifacts"("conversation_id");

-- CreateIndex
CREATE INDEX "chat_artifacts_message_id_idx" ON "chat_artifacts"("message_id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_artifacts" ADD CONSTRAINT "chat_artifacts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_artifacts" ADD CONSTRAINT "chat_artifacts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
