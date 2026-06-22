import type { PrismaClient } from '@prisma/client';

export type KnowledgeChunk = {
  content: string;
  locator: string;
  documentId: string;
  title: string;
  score: number;
};

export type KnowledgeBaseEntry = { title: string; docType: string };

export type IngestChunkInput = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  locator: string;
  contentHash: string;
  embedding: number[];
};

export type IngestDocumentInput = {
  title: string;
  sourceUri: string | null;
  docType: string;
  version: string;
  contentHash: string;
  accessScope: string;
  chunks: IngestChunkInput[];
};

export type KnowledgeRepository = {
  searchChunks(
    embedding: number[],
    options: { topK: number; accessScope: string },
  ): Promise<KnowledgeChunk[]>;
  listKnowledgeBase(accessScope: string): Promise<KnowledgeBaseEntry[]>;
  insertDocumentWithChunks(input: IngestDocumentInput): Promise<string>;
};

function toVectorLiteral(embedding: number[]): string {
  // pgvector acepta el formato textual "[v1,v2,...]" para castear a vector.
  return `[${embedding.join(',')}]`;
}

export function createKnowledgeRepository(prisma: PrismaClient): KnowledgeRepository {
  return {
    async searchChunks(embedding, { topK, accessScope }) {
      // Columnas `Unsupported` (vector) no son accesibles por el cliente tipado:
      // se usa SQL parametrizado con cast `$1::vector`. La query es fija (no LLM),
      // por eso no pasa por el SQL Safety Layer.
      const rows = await prisma.$queryRawUnsafe<KnowledgeChunk[]>(
        `SELECT dc.content AS content,
                dc.locator AS locator,
                dc.document_id AS "documentId",
                d.title AS title,
                (1 - (dc.embedding <=> $1::vector))::float8 AS score
         FROM document_chunks dc
         JOIN documents d ON d.id = dc.document_id
         WHERE d.access_scope = $2 AND d.status = 'INDEXED'
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $3`,
        toVectorLiteral(embedding),
        accessScope,
        topK,
      );

      return rows;
    },

    listKnowledgeBase(accessScope) {
      return prisma.document.findMany({
        where: { accessScope, status: 'INDEXED' },
        select: { title: true, docType: true },
        orderBy: { title: 'asc' },
      });
    },

    async insertDocumentWithChunks(input) {
      const document = await prisma.document.create({
        data: {
          title: input.title,
          sourceUri: input.sourceUri,
          docType: input.docType,
          version: input.version,
          contentHash: input.contentHash,
          accessScope: input.accessScope,
          status: 'INDEXED',
          indexedAt: new Date(),
        },
        select: { id: true },
      });

      for (const chunk of input.chunks) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO document_chunks
             (id, document_id, chunk_index, content, token_count, locator, content_hash, embedding, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector, CURRENT_TIMESTAMP)`,
          document.id,
          chunk.chunkIndex,
          chunk.content,
          chunk.tokenCount,
          chunk.locator,
          chunk.contentHash,
          toVectorLiteral(chunk.embedding),
        );
      }

      return document.id;
    },
  };
}
