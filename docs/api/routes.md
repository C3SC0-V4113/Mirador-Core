# Rutas Base

## Public routes

| Method | Path                                            | Estado                 |
| ------ | ----------------------------------------------- | ---------------------- |
| `GET`  | `/health`                                       | Implementada           |
| `POST` | `/api/auth/login`                               | Implementada           |
| `POST` | `/api/auth/logout`                              | Implementada           |
| `GET`  | `/api/auth/session`                             | Implementada           |
| `POST` | `/api/chat/messages`                            | Implementada protegida |
| `GET`  | `/api/chat/conversations`                       | Implementada protegida |
| `POST` | `/api/chat/artifacts/:artifactId/visualization` | Implementada protegida |
| `GET`  | `/api/schema/catalog`                           | Implementada protegida |

`/api/auth/login` setea la cookie `mirador_session` con `HttpOnly` y
`SameSite=Lax`. Las rutas de chat requieren una sesion CEO valida.

`/api/chat/messages` acepta `{ message, conversation_id?, intent_mode? }` y
devuelve narrativa, `data`, `artifacts`, `chart`, `warnings`,
`suggested_questions`, `quick_actions`, `metadata` y `trace_id`. El `intent_mode`
(`responder`, `analizar`, `reporte_visual`, `plan`) moldea la salida sin descartar
lo pedido en el prompt.

`/api/chat/artifacts/:artifactId/visualization` (mini-chat) edita solo el
`chart_spec` de un artefacto ya generado, sin re-consultar. Si el pedido cambia
datos/periodo/metrica/fuente, responde `{ requires_main_chat: true, reason }` para
derivar al chat principal. Ver
[ADR 0006](../adrs/0006-complete-chat-intent-modes-rich-artifacts-and-chart-mini-chat.md).

`/api/schema/catalog` devuelve un catalogo semantico compacto para el rol CEO. No
expone DDL crudo, tablas internas ni `source_view`.

## Internal routes

| Method | Path                            | Consumidor                       |
| ------ | ------------------------------- | -------------------------------- |
| `POST` | `/internal/core/ask`            | `mirador-mcp` o servicio interno |
| `GET`  | `/internal/core/schema-catalog` | `mirador-mcp` o servicio interno |

Estas rutas requieren:

```text
Authorization: Bearer <CORE_SERVICE_TOKEN>
```

Si `CORE_SERVICE_TOKEN` no esta configurado, responden
`503 INTERNAL_CORE_NOT_CONFIGURED`.

`/internal/core/ask` sigue reservado. `/internal/core/schema-catalog` devuelve el
`BusinessSchemaContext` allowlisted para fallback SQL interno.
