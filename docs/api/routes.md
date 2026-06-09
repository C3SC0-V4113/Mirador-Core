# Rutas Base

## Public routes

| Method | Path                      | Estado                 |
| ------ | ------------------------- | ---------------------- |
| `GET`  | `/health`                 | Implementada           |
| `POST` | `/api/auth/login`         | Implementada           |
| `POST` | `/api/auth/logout`        | Implementada           |
| `GET`  | `/api/auth/session`       | Implementada           |
| `POST` | `/api/chat/messages`      | Reservada protegida    |
| `GET`  | `/api/chat/conversations` | Reservada protegida    |
| `GET`  | `/api/schema/catalog`     | Implementada protegida |

`/api/auth/login` setea la cookie `mirador_session` con `HttpOnly` y
`SameSite=Lax`. Las rutas de chat siguen devolviendo `501` con
`status: "foundation_only"`, pero ahora requieren una sesion CEO valida.

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
