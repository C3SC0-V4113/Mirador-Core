import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { env } from '../src/config/env.js';
import { createEmbeddingProvider } from '../src/modules/knowledge/embeddings/embedding-provider.js';
import {
  createKnowledgeRepository,
  type IngestChunkInput,
} from '../src/modules/knowledge/knowledge.repositories.js';
import { createPrismaClient } from '../src/shared/db/prisma.js';
import { sha256 } from '../src/shared/crypto/sql-hash.js';

// Ingesta dev de conocimiento: trocea por seccion (##), embebe y persiste.
// El servicio de ingesta real (mirador-ingestion) es Fase 10; esto es para local.
// IMPORTANTE: al cambiar EMBEDDING_MODEL hay que reingestar (re-embeber) todo,
// porque los vectores existentes quedan en otro espacio.
const ACCESS_SCOPE = 'CEO';
const SAMPLES_DIR = resolve(process.cwd(), 'knowledge', 'samples');

const DOCUMENTS = [
  { file: 'vision-mision.md', title: 'Visión y Misión de Mirador', docType: 'vision' },
  { file: 'politica-delivery.md', title: 'Política de Delivery', docType: 'policy' },
  { file: 'producto-overview.md', title: 'Overview de Producto', docType: 'product' },
] as const;

function chunkMarkdown(raw: string): { content: string; locator: string }[] {
  const chunks: { content: string; locator: string }[] = [];
  let locator = 'inicio';
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content !== '') {
      chunks.push({ content, locator });
    }
    buffer = [];
  };

  for (const line of raw.split(/\r?\n/u)) {
    const section = /^##\s+(.*)/u.exec(line);
    if (section?.[1] !== undefined) {
      flush();
      locator = section[1].trim();
      continue;
    }

    const title = /^#\s+(.*)/u.exec(line);
    if (title !== null) {
      continue;
    }

    buffer.push(line);
  }

  flush();
  return chunks;
}

async function main() {
  const prisma = createPrismaClient(env.DATABASE_URL_APP);
  const embeddings = createEmbeddingProvider();
  const knowledge = createKnowledgeRepository(prisma);

  try {
    for (const document of DOCUMENTS) {
      const raw = readFileSync(resolve(SAMPLES_DIR, document.file), 'utf8');
      const sections = chunkMarkdown(raw);
      const vectors = await embeddings.embed(sections.map((section) => section.content));

      const chunks: IngestChunkInput[] = sections.map((section, index) => ({
        chunkIndex: index,
        content: section.content,
        tokenCount: Math.ceil(section.content.length / 4),
        locator: section.locator,
        contentHash: sha256(section.content),
        embedding: vectors[index] ?? [],
      }));

      // Reingesta idempotente: borra la version previa del mismo titulo (cascade).
      await prisma.document.deleteMany({ where: { title: document.title } });

      await knowledge.insertDocumentWithChunks({
        title: document.title,
        sourceUri: `knowledge/samples/${document.file}`,
        docType: document.docType,
        version: '1',
        contentHash: sha256(raw),
        accessScope: ACCESS_SCOPE,
        chunks,
      });

      console.log(`Ingested "${document.title}" (${String(chunks.length)} chunks).`);
    }

    console.log(`Knowledge ingestion complete using provider "${env.EMBEDDING_PROVIDER}".`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
