# ADR 0005: Extend Planner With Temporal Context, Clarification Protocol And Per-Customer Revenue

- Date: 2026-06-09
- Status: Accepted

## Context

El chat de ADR 0004 funciona, pero el camino determinista rechazaba preguntas
válidas del CEO con un mensaje genérico. Tres causas: (1) faltaba una métrica de
"ingresos/ventas" en el catálogo; (2) el planner no tenía contexto de fecha, así
que no podía resolver expresiones relativas ("último trimestre", "mes pasado");
(3) las preguntas fuera de catálogo recibían siempre la misma aclaración genérica.
Además, las views `ceo_*` no exponían ingresos por cliente.

## Decision Drivers

- Cubrir vocabulario natural del CEO (ingresos, ventas) sin abrir Text-to-SQL libre.
- Resolver periodos relativos de forma fiable sobre datos sintéticos.
- Dar aclaraciones útiles en vez de un mensaje fijo.
- Mantener todo dentro del catálogo y del SQL Safety Layer.

## Decision

Extender la capa semántica y el contrato del planner, sin cambiar la decisión
determinista de fondo:

- Catálogo: añadir `revenue` ("Ingresos") sobre `ceo_revenue_summary` y
  `customer_revenue` ("Ingresos por Cliente") sobre la nueva view gobernada
  `ceo_customer_revenue`; enriquecer sinónimos en español.
- View `ceo_customer_revenue` (ingresos facturados por cliente y mes), propiedad
  de su migración con `GRANT SELECT` a `mirador_readonly` (ADR 0003).
- Contexto temporal: `planMetricQuery` recibe `{ today, earliestPeriod,
latestPeriod }` (cobertura calculada una vez con una consulta gobernada,
  cacheada por proceso). El planner ancla las expresiones relativas en el último
  periodo de datos disponible.
- Protocolo de aclaración: `planMetricQuery` devuelve un `MetricPlan`
  (`{ kind: 'metric'; query }` o `{ kind: 'clarify'; message }`). Cuando no hay
  métrica, el planner produce una aclaración específica (qué entendió y qué
  precisar), que el orquestador devuelve tal cual.

## Consequences

### Positive

- Preguntas de ingresos y periodos relativos se resuelven en el camino determinista.
- Las aclaraciones guían al CEO en vez de frustrarlo.
- La allowlist de SQL Safety se deriva del catálogo, así que la view nueva queda
  permitida automáticamente.

### Negative

- Comparaciones tipo "mejor mes", preguntas multi-paso ("ingresos del cliente más
  débil") y gráficos de pastel siguen fuera de alcance: se responden con una
  aclaración precisa, no con datos.
- El planner depende de un campo `clarification` bien formado del modelo; hay un
  fallback por defecto si falta.

## Implementation Notes

- `config/metric-catalog.json` sube a `version` `2026-06-mvp.2`.
- Cobertura temporal vía `SELECT min/max(period_month) FROM ceo_revenue_summary`,
  que pasa el SQL Safety Layer (min/max y la columna están permitidos).
- El proveedor `stub` también implementa `MetricPlan` para tests sin red.

## Related Decisions

- [ADR 0004: Adopt Chat Orchestrator With Deterministic Metric Path And Pluggable LLM](0004-adopt-chat-orchestrator-with-deterministic-metric-path-and-pluggable-llm.md)
- [ADR 0003: Decouple Role And Extension Provisioning From The Schema Migration](0003-decouple-role-and-extension-provisioning-from-schema-migration.md)
- `docs/database-model.md`
- `docs/checkpoints.md`
