import { env } from '../../config/env.js';
import type { MetricDefinition, MetricQuery } from '../schema-catalog/metric-catalog.js';
import { SqlSafetyError, validateReadonlySql, type SqlSafetyResult } from './sql-safety.js';

const operatorSql: Record<MetricQuery['filters'][number]['operator'], string> = {
  eq: '=',
  neq: '<>',
  gte: '>=',
  lte: '<=',
  gt: '>',
  lt: '<',
  in: 'IN',
};

// Compila un MetricQuery validado a SQL determinista sobre la view ceo_* de la
// metrica. Las views ya estan agregadas a su grano, asi que el compilador solo
// proyecta columnas allowlisted, aplica filtros y ordena por la columna temporal.
// El resultado pasa ademas por validateReadonlySql como segunda barrera.
export function compileMetricQuery(query: MetricQuery, metric: MetricDefinition): SqlSafetyResult {
  const selectColumns = new Set<string>(query.dimensions);

  if (selectColumns.size === 0 && metric.time_column !== null) {
    selectColumns.add(metric.time_column);
  }

  selectColumns.add(metric.measure);

  const conditions: string[] = [];

  for (const filter of query.filters) {
    if (!metric.filters_allowed.includes(filter.field)) {
      throw new SqlSafetyError(
        `Filter "${filter.field}" is not allowed for metric "${metric.name}".`,
        'METRIC_FILTER_NOT_ALLOWED',
      );
    }

    conditions.push(buildCondition(filter));
  }

  if (query.time_range !== undefined && metric.time_column !== null) {
    conditions.push(`${metric.time_column} >= ${encodeLiteral(query.time_range.from)}`);
    conditions.push(`${metric.time_column} <= ${encodeLiteral(query.time_range.to)}`);
  }

  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const orderClause = metric.time_column !== null ? ` ORDER BY ${metric.time_column}` : '';
  const limit = Math.min(query.limit, env.ANALYTICS_MAX_LIMIT);

  const sql = `SELECT ${[...selectColumns].join(', ')} FROM ${metric.source_view}${whereClause}${orderClause} LIMIT ${String(limit)}`;

  return validateReadonlySql(sql);
}

function buildCondition(filter: MetricQuery['filters'][number]) {
  const operator = operatorSql[filter.operator];

  if (filter.operator === 'in') {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];

    if (values.length === 0) {
      throw new SqlSafetyError('IN filter requires at least one value.', 'METRIC_FILTER_INVALID');
    }

    return `${filter.field} IN (${values.map(encodeLiteral).join(', ')})`;
  }

  if (Array.isArray(filter.value)) {
    throw new SqlSafetyError(
      `Operator "${filter.operator}" does not accept a list value.`,
      'METRIC_FILTER_INVALID',
    );
  }

  return `${filter.field} ${operator} ${encodeLiteral(filter.value)}`;
}

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 32 || code === 127) {
      return true;
    }
  }

  return false;
}

function encodeLiteral(value: string | number | boolean): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SqlSafetyError('Numeric filter value must be finite.', 'METRIC_FILTER_INVALID');
    }

    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (hasControlChar(value)) {
    throw new SqlSafetyError('Filter value contains a control character.', 'METRIC_FILTER_INVALID');
  }

  // Postgres con standard_conforming_strings (default) escapa comillas duplicandolas.
  return `'${value.replace(/'/gu, "''")}'`;
}
