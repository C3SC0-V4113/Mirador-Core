# Capa Semantica Y Estrategia De Modelos

## Decision principal

El camino principal para metricas no es Text-to-SQL libre. El modelo debe producir
un `MetricQuery` validado contra un catalogo semantico versionado; un generador
determinista compila ese contrato a SQL sobre views `ceo_*`.

Text-to-SQL queda como fallback gobernado para preguntas exploratorias fuera del
catalogo, siempre pasando por las mismas barreras de seguridad.

## Piezas

- **Metric catalog**: YAML/JSON versionado con metricas, sinonimos, dimensiones,
  filtros, grano, formato y `source_view`.
- **MetricQuery**: contrato estructurado que el LLM devuelve.
- **Compiler determinista**: convierte `MetricQuery` a SQL.
- **SQL Safety Layer**: valida AST, solo `SELECT`, allowlists, limites, timeout y max rows.
- **BusinessSchemaContext**: contexto reducido para fallback SQL, sin DDL crudo.

## Defaults de modelos

- `ORCHESTRATOR_MODEL`: modelo planificador fuerte.
- `LIGHT_MODEL`: modelo barato para clasificacion, aclaraciones, chart specs y
  planificacion simple.
- `LLM_PROVIDER`: proveedor configurable.

La implementacion debe mantener esta capa intercambiable por configuracion. El
scaffold no llama todavia a ningun proveedor LLM.

## Regla de seguridad

El SQL candidato y el SQL compilado pasan por el mismo SQL Safety Layer. Prisma no
es la unica barrera de seguridad para consultas generadas o compiladas.
