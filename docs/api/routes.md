# Rutas Base

## Public routes

| Method | Path                      | Estado       |
| ------ | ------------------------- | ------------ |
| `GET`  | `/health`                 | Implementada |
| `POST` | `/api/auth/login`         | Reservada    |
| `POST` | `/api/auth/logout`        | Reservada    |
| `GET`  | `/api/auth/session`       | Reservada    |
| `POST` | `/api/chat/messages`      | Reservada    |
| `GET`  | `/api/chat/conversations` | Reservada    |
| `GET`  | `/api/schema/catalog`     | Reservada    |

Las rutas reservadas devuelven `501` con `status: "foundation_only"` hasta que el
dominio este implementado.

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
