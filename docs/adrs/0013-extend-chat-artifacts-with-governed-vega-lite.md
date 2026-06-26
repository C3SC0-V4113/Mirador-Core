# ADR 0013: Extend Chat Artifacts With Governed Vega-Lite

- Date: 2026-06-25
- Status: Accepted

## Context

The existing `CHART` artifact renders deterministic line, bar, stacked bar, area,
and pie charts. Some explicit requests (heatmaps, scatter plots, layers, facets,
and combined views) cannot be represented without changing their visual meaning.
The browser also needs readable business labels while retaining raw field keys.

## Decision Drivers

- Preserve the inexpensive and deterministic Recharts path as the default.
- Support richer visual semantics without exposing arbitrary Vega execution.
- Keep `/internal/core/*` UI-neutral for `mirador-mcp`.
- Preserve rows when dynamic generation is disabled or fails.
- Make generation and editing costs explicit.

## Decision

- Add `DYNAMIC_CHART` as an additive `ArtifactType`; it extends, never replaces,
  `CHART`.
- `POST /api/chat/messages` alone accepts `dynamic_charts_enabled`, defaulting to
  `false`.
- The planner classifies requested visual semantics. Simple charts remain
  `CHART`. Incompatible requests generate a Vega-Lite v6 specification only when
  the flag is enabled.
- Disabled or failed generation degrades to `TABLE` with a warning and unchanged
  rows.
- Vega-Lite is validated server-side: fixed v6 schema, trusted inline
  `data.values`, allowlisted marks/compositions/transforms, and row, size, layer,
  view, and depth limits. URLs, images, expressions, custom functions, signals,
  and external resources are rejected.
- Dynamic chart edits reuse
  `POST /api/chat/artifacts/:artifactId/visualization`. Invalid regeneration is
  rejected before persistence, preserving the previous specification.
- `/internal/core/ask` does not accept the feature flag and therefore never
  exposes Vega-Lite. Its portable `chart_hint` remains the simple chart contract.
- The semantic catalog owns curated Spanish `field_labels`; unknown snake_case
  fields use deterministic humanization. Raw keys remain unchanged in rows.

## Compatibility Matrix

| Requested semantics                         | Flag off                           | Flag on                  |
| ------------------------------------------- | ---------------------------------- | ------------------------ |
| Line/bar/real stacked bar/area/pie          | `CHART`                            | `CHART`                  |
| Heatmap/scatter/layers/facets/combined view | `TABLE` + warning                  | `DYNAMIC_CHART`          |
| Dynamic generation or validation failure    | `TABLE` + warning                  | `TABLE` + warning        |
| Historical `DYNAMIC_CHART`                  | Persisted and rehydrated           | Persisted and rehydrated |
| `/internal/core/ask`                        | Neutral data + simple `chart_hint` | Not applicable           |

## Cost

Vega, Vega-Lite, and vega-embed use the BSD-3-Clause license and have no
per-render fee. Costs are indirect: frontend bundle transfer and browser CPU.

Creation or natural-language editing adds one `LIGHT_MODEL` call. With the
currently configured `gpt-5-mini` rates of USD 0.25 per million input tokens and
USD 2.00 per million output tokens:

```text
estimated_cost_usd =
  (input_tokens / 1_000_000 × 0.25) +
  (output_tokens / 1_000_000 × 2.00)
```

Example: 4,000 input tokens and 800 output tokens cost approximately USD 0.0026.
This is an estimate, not a guaranteed bill.

## Consequences

### Positive

- Rich visual requests preserve their intended semantics.
- Existing consumers and the default chart path remain stable.
- Unsafe or excessive Vega-Lite output cannot reach persistence or the browser.
- Tables, narratives, and charts share readable labels without renaming data.

### Negative

- Dynamic creation and edits add LLM latency and cost.
- The frontend downloads Vega libraries only when a dynamic artifact is rendered.
- The validator intentionally supports a constrained Vega-Lite subset.

## Implementation Notes

- The Prisma migration only adds an enum value and never resets data.
- The backend injects trusted rows into `data.values`; the LLM controls only the
  allowlisted visual body.
- Historical artifacts render independently of the current browser preference.

## Related Decisions

- [ADR 0004](0004-adopt-chat-orchestrator-with-deterministic-metric-path-and-pluggable-llm.md)
- [ADR 0006](0006-complete-chat-intent-modes-rich-artifacts-and-chart-mini-chat.md)
- [ADR 0011](0011-expose-governed-core-pipeline-via-internal-service-to-service-api.md)
