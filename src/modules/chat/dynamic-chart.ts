import { AppError } from '../../shared/errors/app-error.js';

const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json';
const MAX_ROWS = 200;
const MAX_SPEC_BYTES = 50_000;
const MAX_LAYERS = 4;
const MAX_VIEWS = 4;
const MAX_DEPTH = 12;

const ALLOWED_MARKS = new Set([
  'area',
  'bar',
  'circle',
  'line',
  'point',
  'rect',
  'rule',
  'square',
  'tick',
]);
const COMPOSITION_KEYS = new Set(['layer', 'facet', 'hconcat', 'vconcat']);
const FORBIDDEN_KEYS = new Set([
  'calculate',
  'cursor',
  'data',
  'expr',
  'expression',
  'filter',
  'href',
  'image',
  'params',
  'selection',
  'signal',
  'url',
]);
const ALLOWED_TRANSFORMS = new Set(['aggregate', 'bin', 'fold', 'stack', 'timeUnit']);
const ALLOWED_TRANSFORM_KEYS = new Set([
  'aggregate',
  'as',
  'bin',
  'field',
  'fold',
  'groupby',
  'offset',
  'op',
  'sort',
  'stack',
  'timeUnit',
]);

export function buildValidatedDynamicChartSpec(
  candidate: unknown,
  rows: unknown[],
): Record<string, unknown> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw invalidDynamicSpec('Dynamic charts require at least one data row.');
  }

  if (rows.length > MAX_ROWS) {
    throw invalidDynamicSpec(`Dynamic charts support at most ${String(MAX_ROWS)} rows.`);
  }

  if (!isRecord(candidate)) {
    throw invalidDynamicSpec('The generated Vega-Lite specification is not an object.');
  }

  const spec = structuredClone(candidate);
  delete spec.$schema;

  if ('data' in spec) {
    validateInlineData(spec.data, rows);
    delete spec.data;
  }

  const counters = { layers: 0, views: 1 };
  validateNode(spec, 0, counters);

  if (counters.layers > MAX_LAYERS || counters.views > MAX_VIEWS) {
    throw invalidDynamicSpec('The generated Vega-Lite specification is too complex.');
  }

  const validated = {
    $schema: VEGA_LITE_SCHEMA,
    data: { values: rows },
    ...spec,
  };

  if (Buffer.byteLength(JSON.stringify(validated), 'utf8') > MAX_SPEC_BYTES) {
    throw invalidDynamicSpec('The generated Vega-Lite specification is too large.');
  }

  return validated;
}

export function isDynamicChartSpec(value: unknown): value is Record<string, unknown> {
  try {
    if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.values)) {
      return false;
    }

    buildValidatedDynamicChartSpec(value, value.data.values);
    return value.$schema === VEGA_LITE_SCHEMA;
  } catch {
    return false;
  }
}

function validateNode(node: unknown, depth: number, counters: { layers: number; views: number }) {
  if (depth > MAX_DEPTH) {
    throw invalidDynamicSpec('The generated Vega-Lite specification is too deeply nested.');
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      validateNode(item, depth + 1, counters);
    }
    return;
  }

  if (!isRecord(node)) {
    if (typeof node === 'string' && /(?:https?:\/\/|javascript:|data:image)/iu.test(node)) {
      throw invalidDynamicSpec('External resources are not allowed in Vega-Lite specifications.');
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw invalidDynamicSpec(`Vega-Lite property "${key}" is not allowed.`);
    }

    if (key === 'mark') {
      validateMark(value);
    } else if (key === 'transform') {
      validateTransforms(value);
    } else if (COMPOSITION_KEYS.has(key)) {
      validateComposition(key, value, counters);
    } else if ((key === 'width' || key === 'height') && typeof value === 'number') {
      const limit = key === 'width' ? 1_000 : 800;
      if (!Number.isFinite(value) || value <= 0 || value > limit) {
        throw invalidDynamicSpec(`Vega-Lite ${key} exceeds the allowed limit.`);
      }
    }

    validateNode(value, depth + 1, counters);
  }
}

function validateInlineData(data: unknown, rows: unknown[]) {
  if (!isRecord(data) || !Array.isArray(data.values)) {
    throw invalidDynamicSpec('Only inline data.values is allowed.');
  }

  if (JSON.stringify(data.values) !== JSON.stringify(rows)) {
    throw invalidDynamicSpec('Generated Vega-Lite data must preserve the query rows exactly.');
  }
}

function validateMark(mark: unknown) {
  const markType =
    typeof mark === 'string'
      ? mark
      : isRecord(mark) && typeof mark.type === 'string'
        ? mark.type
        : '';

  if (!ALLOWED_MARKS.has(markType)) {
    throw invalidDynamicSpec(`Vega-Lite mark "${markType}" is not allowed.`);
  }
}

function validateTransforms(value: unknown) {
  if (!Array.isArray(value) || value.length > 4) {
    throw invalidDynamicSpec('Vega-Lite transforms exceed the allowed limit.');
  }

  for (const transform of value) {
    if (!isRecord(transform)) {
      throw invalidDynamicSpec('Every Vega-Lite transform must be an object.');
    }

    const keys = Object.keys(transform);
    const transformKinds = keys.filter((key) => ALLOWED_TRANSFORMS.has(key));
    if (
      keys.length === 0 ||
      transformKinds.length !== 1 ||
      keys.some((key) => !ALLOWED_TRANSFORM_KEYS.has(key))
    ) {
      throw invalidDynamicSpec('The generated Vega-Lite transform is not allowlisted.');
    }
  }
}

function validateComposition(
  key: string,
  value: unknown,
  counters: { layers: number; views: number },
) {
  if (key === 'facet') {
    if (!isRecord(value)) {
      throw invalidDynamicSpec('Vega-Lite facet must be an object.');
    }
    counters.views += 1;
    return;
  }

  if (!Array.isArray(value)) {
    throw invalidDynamicSpec(`Vega-Lite ${key} must be an array.`);
  }

  counters.views += value.length;
  if (key === 'layer') {
    counters.layers += value.length;
  }
}

function invalidDynamicSpec(message: string) {
  return new AppError(message, 422, 'DYNAMIC_CHART_SPEC_INVALID');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
