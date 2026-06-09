-- Extensiones requeridas por el schema (gen_random_uuid via pgcrypto, embeddings via vector).
-- Se crean en el arranque del contenedor local, antes de las migraciones Prisma.
-- En produccion las extensiones se habilitan por el proveedor gestionado (Railway). Ver ADR 0003.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
