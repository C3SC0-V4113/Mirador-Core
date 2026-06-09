import { parse } from 'pgsql-ast-parser';
import type { SelectFromStatement, Statement } from 'pgsql-ast-parser';

import { env } from '../../config/env.js';
import { buildBusinessSchemaContext } from '../schema-catalog/metric-catalog.js';

const allowedFunctions = new Set(['avg', 'count', 'max', 'min', 'round', 'sum']);

export type SqlSafetyResult = {
  sql: string;
  sourceViews: string[];
  limit: number;
};

export class SqlSafetyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export function validateReadonlySql(sql: string): SqlSafetyResult {
  const statements = parse(sql);

  if (statements.length !== 1) {
    throw new SqlSafetyError('Only one SQL statement is allowed.', 'SQL_MULTIPLE_STATEMENTS');
  }

  const statement = statements[0];

  if (statement.type !== 'select') {
    throw new SqlSafetyError('Only SELECT statements are allowed.', 'SQL_ONLY_SELECT_ALLOWED');
  }

  if (statement.for !== undefined) {
    throw new SqlSafetyError('SELECT locking clauses are not allowed.', 'SQL_LOCKING_NOT_ALLOWED');
  }

  const schema = buildBusinessSchemaContext();
  const allowedViews = new Map(schema.views.map((view) => [view.name, new Set(view.columns)]));
  const viewNames = getSourceViews(statement);

  if (viewNames.length === 0) {
    throw new SqlSafetyError(
      'SQL must read from an allowlisted business view.',
      'SQL_MISSING_SOURCE_VIEW',
    );
  }

  for (const viewName of viewNames) {
    if (!allowedViews.has(viewName)) {
      throw new SqlSafetyError(`View "${viewName}" is not allowed.`, 'SQL_SOURCE_NOT_ALLOWED');
    }
  }

  const allowedColumns = new Set<string>();

  for (const viewName of viewNames) {
    for (const column of allowedViews.get(viewName) ?? []) {
      allowedColumns.add(column);
    }
  }

  validateColumns(statement, allowedColumns);
  validateFunctions(statement);

  const limit = getLimit(statement);

  if (limit > env.ANALYTICS_MAX_LIMIT) {
    throw new SqlSafetyError(
      `LIMIT cannot exceed ${String(env.ANALYTICS_MAX_LIMIT)}.`,
      'SQL_LIMIT_TOO_HIGH',
    );
  }

  return {
    sql: hasLimit(statement)
      ? sql
      : `${sql.trim().replace(/;$/u, '')} LIMIT ${String(env.ANALYTICS_DEFAULT_LIMIT)}`,
    sourceViews: viewNames,
    limit: hasLimit(statement) ? limit : env.ANALYTICS_DEFAULT_LIMIT,
  };
}

function getSourceViews(statement: SelectFromStatement) {
  const views: string[] = [];

  for (const source of statement.from ?? []) {
    if (source.type !== 'table') {
      throw new SqlSafetyError(
        'Subqueries, function sources and complex FROM clauses are not allowed.',
        'SQL_FROM_NOT_ALLOWED',
      );
    }

    views.push(source.name.name);

    if (source.join !== undefined && source.join !== null) {
      throw new SqlSafetyError(
        'JOIN clauses are not allowed in fallback SQL.',
        'SQL_JOIN_NOT_ALLOWED',
      );
    }
  }

  return views;
}

function validateColumns(statement: SelectFromStatement, allowedColumns: Set<string>) {
  for (const column of statement.columns ?? []) {
    const refs = collectRefs(column.expr);

    for (const ref of refs) {
      if (ref === '*') {
        throw new SqlSafetyError('SELECT * is not allowed.', 'SQL_STAR_NOT_ALLOWED');
      }

      if (!allowedColumns.has(ref)) {
        throw new SqlSafetyError(`Column "${ref}" is not allowed.`, 'SQL_COLUMN_NOT_ALLOWED');
      }
    }
  }

  for (const expr of [
    ...(statement.groupBy ?? []),
    ...(statement.orderBy ?? []).map((order) => order.by),
  ]) {
    for (const ref of collectRefs(expr)) {
      if (!allowedColumns.has(ref)) {
        throw new SqlSafetyError(`Column "${ref}" is not allowed.`, 'SQL_COLUMN_NOT_ALLOWED');
      }
    }
  }

  for (const expr of [statement.where, statement.having]) {
    if (expr === undefined || expr === null) {
      continue;
    }

    for (const ref of collectRefs(expr)) {
      if (!allowedColumns.has(ref)) {
        throw new SqlSafetyError(`Column "${ref}" is not allowed.`, 'SQL_COLUMN_NOT_ALLOWED');
      }
    }
  }
}

function validateFunctions(statement: Statement) {
  for (const call of collectCalls(statement)) {
    if (!allowedFunctions.has(call)) {
      throw new SqlSafetyError(`Function "${call}" is not allowed.`, 'SQL_FUNCTION_NOT_ALLOWED');
    }
  }
}

function hasLimit(statement: SelectFromStatement) {
  return statement.limit?.limit !== undefined && statement.limit.limit !== null;
}

function getLimit(statement: SelectFromStatement) {
  const limitExpression = statement.limit?.limit;

  if (limitExpression === undefined || limitExpression === null) {
    return env.ANALYTICS_DEFAULT_LIMIT;
  }

  if (limitExpression.type !== 'integer') {
    throw new SqlSafetyError('LIMIT must be a positive integer.', 'SQL_LIMIT_INVALID');
  }

  return limitExpression.value;
}

function collectRefs(node: unknown): string[] {
  const refs: string[] = [];
  walkAst(node, (candidate) => {
    if (isAstRecord(candidate) && candidate.type === 'ref' && typeof candidate.name === 'string') {
      refs.push(candidate.name);
    }
  });

  return refs;
}

function collectCalls(node: unknown): string[] {
  const calls: string[] = [];
  walkAst(node, (candidate) => {
    if (!isAstRecord(candidate) || candidate.type !== 'call' || !isAstRecord(candidate.function)) {
      return;
    }

    const functionName = candidate.function.name;

    if (typeof functionName === 'string') {
      calls.push(functionName.toLowerCase());
    }
  });

  return calls;
}

function walkAst(node: unknown, visit: (node: unknown) => void) {
  visit(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      walkAst(item, visit);
    }

    return;
  }

  if (!isAstRecord(node)) {
    return;
  }

  for (const value of Object.values(node)) {
    walkAst(value, visit);
  }
}

function isAstRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
