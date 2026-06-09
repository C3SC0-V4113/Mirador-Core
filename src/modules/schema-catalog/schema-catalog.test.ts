import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.js';
import { env } from '../../config/env.js';
import { createFakePrisma } from '../../shared/testing/fake-prisma.js';
import {
  buildBusinessSchemaContext,
  buildMetricCatalogContext,
  validateMetricQuery,
} from './metric-catalog.js';

describe('schema catalog', () => {
  it('requires a CEO session for the public catalog', async () => {
    const app = await buildApp({ prisma: await createFakePrisma() });

    const response = await app.inject({
      method: 'GET',
      url: '/api/schema/catalog',
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('returns a compact authenticated metric catalog without raw tables', async () => {
    const app = await buildApp({ prisma: await createFakePrisma() });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.CEO_EMAIL,
        password: 'mirador-dev-password',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/schema/catalog',
      headers: {
        cookie: loginResponse.headers['set-cookie'] as string,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      role: 'CEO',
    });
    expect(JSON.stringify(response.json())).not.toContain('source_view');
    expect(JSON.stringify(response.json())).not.toContain('CREATE VIEW');

    await app.close();
  });

  it('loads the official MVP metrics', () => {
    const catalog = buildMetricCatalogContext();
    const metricNames = catalog.metrics.map((metric) => metric.name);

    expect(metricNames).toEqual(
      expect.arrayContaining([
        'mrr',
        'arr',
        'mrr_growth',
        'expansion_revenue',
        'churn_rate',
        'at_risk_customers',
        'pipeline_by_stage',
        'close_forecast',
        'projects_at_risk',
        'project_margin',
        'critical_tickets',
        'sla_breaches',
        'burn_rate',
        'runway',
        'cost_by_area',
      ]),
    );
  });

  it('builds the allowlisted business schema context from ceo views only', () => {
    const context = buildBusinessSchemaContext();

    expect(context.views.length).toBeGreaterThan(0);
    expect(context.views.every((view) => view.name.startsWith('ceo_'))).toBe(true);
    expect(JSON.stringify(context)).not.toContain('users');
  });

  it('validates MetricQuery against metric dimensions and filters', () => {
    expect(() =>
      validateMetricQuery({
        metric: 'mrr',
        dimensions: ['period_month'],
        filters: [{ field: 'period_month', operator: 'gte', value: '2026-01-01' }],
        limit: 25,
      }),
    ).not.toThrow();

    expect(() =>
      validateMetricQuery({
        metric: 'mrr',
        dimensions: ['customer_name'],
        filters: [],
      }),
    ).toThrow(/does not allow dimensions/u);

    expect(() =>
      validateMetricQuery({
        metric: 'unknown_metric',
        dimensions: [],
        filters: [],
      }),
    ).toThrow(/not in the semantic catalog/u);
  });
});
