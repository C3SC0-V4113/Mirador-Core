# Capa De Conocimiento RAG

## Objetivo

Responder preguntas documentales no metricas dentro del mismo chat ejecutivo:
vision, mision, politicas, procesos, descripcion de productos y contexto interno.

Un prompt puede mezclar metrica y conocimiento. El resultado debe ser una sola
respuesta con artefactos de datos y narrativa documental con citas.

## Componentes

- **Knowledge catalog**: tabla `documents` con metadata, version, hash, scope y estado.
- **Document chunks**: tabla `document_chunks` con contenido, locator y embedding.
- **Retrieval**: busqueda vectorial top-k filtrada por rol/scope.
- **Synthesis**: el contenido recuperado se trata como dato, no como instruccion.
- **Ingestion**: servicio separado `ceo-chat-ingestion`, no parte del hot path.

## Infra prevista

- Cloudflare R2 para archivos fuente.
- PostgreSQL + `pgvector` para embeddings y chunks.
- Servicio Railway para ingesta asincrona.

## Fuera del scaffold

La primera base no implementa parseo, embeddings, pgvector ni rerank. Solo deja la
documentacion y frontera de responsabilidad para implementarlo despues.
