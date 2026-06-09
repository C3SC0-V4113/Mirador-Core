import { describe, expect, it } from 'vitest';

import { validateReadonlySql } from './sql-safety.js';

describe('SQL Safety Layer', () => {
  it('accepts an explicit SELECT over an allowlisted CEO view', () => {
    expect(
      validateReadonlySql('select period_month, revenue from ceo_revenue_summary limit 25'),
    ).toMatchObject({
      sourceViews: ['ceo_revenue_summary'],
      limit: 25,
    });
  });

  it('adds a default limit when the query omits it', () => {
    expect(
      validateReadonlySql('select period_month, revenue from ceo_revenue_summary'),
    ).toMatchObject({
      sql: 'select period_month, revenue from ceo_revenue_summary LIMIT 100',
      limit: 100,
    });
  });

  it('rejects DML, multiple statements and internal tables', () => {
    expect(() => validateReadonlySql("update users set email = 'x'")).toThrow(/Only SELECT/u);
    expect(() =>
      validateReadonlySql('select period_month from ceo_revenue_summary; select email from users'),
    ).toThrow(/Only one/u);
    expect(() => validateReadonlySql('select email from users limit 10')).toThrow(/not allowed/u);
  });

  it('rejects star selection, unknown columns, unsafe functions and excessive limits', () => {
    expect(() => validateReadonlySql('select * from ceo_revenue_summary limit 10')).toThrow(
      /SELECT \*/u,
    );
    expect(() =>
      validateReadonlySql('select password_hash from ceo_revenue_summary limit 10'),
    ).toThrow(/Column/u);
    expect(() =>
      validateReadonlySql('select pg_sleep(1) from ceo_revenue_summary limit 10'),
    ).toThrow(/Function/u);
    expect(() =>
      validateReadonlySql('select period_month from ceo_revenue_summary limit 10000'),
    ).toThrow(/LIMIT/u);
  });
});
