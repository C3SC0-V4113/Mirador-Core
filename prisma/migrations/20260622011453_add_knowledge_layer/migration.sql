-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'INDEXED', 'FAILED');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "source_uri" TEXT,
    "doc_type" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "content_hash" TEXT NOT NULL,
    "access_scope" TEXT NOT NULL DEFAULT 'CEO',
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "indexed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "locator" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_access_scope_idx" ON "documents"("access_scope");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indice vectorial HNSW (distancia coseno) para retrieval top-k.
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- La base de conocimiento la escribe la ingesta y la lee el retrieval, ambos como
-- rol mirador_app. El rol read-only analitico no la toca. Ver ADR 0003.
GRANT SELECT, INSERT, UPDATE, DELETE ON "documents", "document_chunks" TO mirador_app;
