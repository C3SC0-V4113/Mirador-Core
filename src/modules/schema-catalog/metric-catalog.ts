import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const metricDefinitionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  synonyms: z.array(z.string().min(1)),
  grain: z.string().min(1),
  source_view: z.string().startsWith('ceo_'),
  measure: z.string().min(1),
  dimensions: z.array(z.string().min(1)),
  filters_allowed: z.array(z.string().min(1)),
  time_column: z.string().min(1).nullable(),
  format: z.enum(['currency_usd', 'percent', 'integer', 'decimal']),
  default_chart: z.enum(['line', 'bar', 'stacked_bar', 'table']),
});

const metricCatalogSchema = z.object({
  version: z.string().min(1),
  role: z.literal('CEO'),
  metrics: z.array(metricDefinitionSchema).min(1),
});

export const metricFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in']),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ]),
});

export const metricQuerySchema = z.object({
  metric: z.string().min(1),
  dimensions: z.array(z.string().min(1)).default([]),
  filters: z.array(metricFilterSchema).default([]),
  time_range: z
    .object({
      from: z.iso.date(),
      to: z.iso.date(),
    })
    .optional(),
  compare_to: z.enum(['previous_period', 'previous_year']).optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export type MetricCatalog = z.infer<typeof metricCatalogSchema>;
export type MetricDefinition = MetricCatalog['metrics'][number];
export type MetricQuery = z.infer<typeof metricQuerySchema>;

let cachedCatalog: MetricCatalog | undefined;

export function loadMetricCatalog() {
  if (cachedCatalog !== undefined) {
    return cachedCatalog;
  }

  const catalogPath = resolve(process.cwd(), 'config', 'metric-catalog.json');
  const rawCatalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown;
  cachedCatalog = metricCatalogSchema.parse(rawCatalog);

  return cachedCatalog;
}

export function validateMetricQuery(input: unknown) {
  const query = metricQuerySchema.parse(input);
  const catalog = loadMetricCatalog();
  const metric = catalog.metrics.find((candidate) => candidate.name === query.metric);

  if (metric === undefined) {
    throw new Error(`Metric "${query.metric}" is not in the semantic catalog.`);
  }

  const invalidDimensions = query.dimensions.filter(
    (dimension) => !metric.dimensions.includes(dimension),
  );

  if (invalidDimensions.length > 0) {
    throw new Error(
      `Metric "${query.metric}" does not allow dimensions: ${invalidDimensions.join(', ')}.`,
    );
  }

  const invalidFilters = query.filters.filter(
    (filter) => !metric.filters_allowed.includes(filter.field),
  );

  if (invalidFilters.length > 0) {
    throw new Error(
      `Metric "${query.metric}" does not allow filters: ${invalidFilters
        .map((filter) => filter.field)
        .join(', ')}.`,
    );
  }

  return {
    query,
    metric,
  };
}

export function buildMetricCatalogContext() {
  const catalog = loadMetricCatalog();

  return {
    version: catalog.version,
    role: catalog.role,
    metrics: catalog.metrics.map((metric) => ({
      name: metric.name,
      label: metric.label,
      description: metric.description,
      synonyms: metric.synonyms,
      grain: metric.grain,
      dimensions: metric.dimensions,
      filters_allowed: metric.filters_allowed,
      format: metric.format,
      default_chart: metric.default_chart,
    })),
  };
}

export function buildBusinessSchemaContext() {
  const catalog = loadMetricCatalog();
  const views = new Map<string, Set<string>>();

  for (const metric of catalog.metrics) {
    const columns = views.get(metric.source_view) ?? new Set<string>();
    columns.add(metric.measure);

    for (const dimension of metric.dimensions) {
      columns.add(dimension);
    }

    for (const filter of metric.filters_allowed) {
      columns.add(filter);
    }

    if (metric.time_column !== null) {
      columns.add(metric.time_column);
    }

    views.set(metric.source_view, columns);
  }

  return {
    version: catalog.version,
    views: [...views.entries()].map(([name, columns]) => ({
      name,
      columns: [...columns].sort(),
    })),
  };
}
