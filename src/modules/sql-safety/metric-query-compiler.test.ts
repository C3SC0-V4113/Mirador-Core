import { describe, expect, it } from 'vitest';

import { validateMetricQuery } from '../schema-catalog/metric-catalog.js';
import { compileMetricQuery } from './metric-query-compiler.js';

describe('MetricQuery compiler', () => {
  it('compiles a metric to governed SQL over its ceo_ view', () => {
    const { query, metric } = validateMetricQuery({ metric: 'mrr' });
    const result = compileMetricQuery(query, metric);

    expect(result.sourceViews).toEqual(['ceo_revenue_summary']);
    expect(result.sql).toContain('FROM ceo_revenue_summary');
    expect(result.sql).toContain('mrr');
    expect(result.sql).toContain('ORDER BY period_month');
    expect(result.sql).toMatch(/LIMIT 100$/u);
  });

  it('applies a time_range over the metric time column', () => {
    const { query, metric } = validateMetricQuery({
      metric: 'mrr',
      time_range: { from: '2026-01-01', to: '2026-03-31' },
    });
    const result = compileMetricQuery(query, metric);

    expect(result.sql).toContain("period_month >= '2026-01-01'");
    expect(result.sql).toContain("period_month <= '2026-03-31'");
  });

  it('applies allowlisted filters', () => {
    const { query, metric } = validateMetricQuery({
      metric: 'churn_rate',
      filters: [{ field: 'risk_level', operator: 'eq', value: 'high' }],
    });
    const result = compileMetricQuery(query, metric);

    expect(result.sql).toContain("risk_level = 'high'");
  });

  it('compiles customer_revenue with a customer_name filter over its dedicated view', () => {
    const { query, metric } = validateMetricQuery({
      metric: 'customer_revenue',
      filters: [{ field: 'customer_name', operator: 'eq', value: 'Zenith Finance' }],
    });
    const result = compileMetricQuery(query, metric);

    expect(result.sourceViews).toEqual(['ceo_customer_revenue']);
    expect(result.sql).toContain("customer_name = 'Zenith Finance'");
    expect(result.sql).toContain('FROM ceo_customer_revenue');
  });

  it('escapes single quotes in string filter values to prevent injection', () => {
    const { query, metric } = validateMetricQuery({
      metric: 'churn_rate',
      filters: [{ field: 'segment', operator: 'eq', value: "Ent'erprise" }],
    });
    const result = compileMetricQuery(query, metric);

    expect(result.sql).toContain("segment = 'Ent''erprise'");
  });
});
