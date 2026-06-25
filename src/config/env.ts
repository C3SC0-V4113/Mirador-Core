import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const envFilePath = resolve(process.cwd(), '.env');

if (existsSync(envFilePath)) {
  const envFileContents = readFileSync(envFilePath, 'utf8');

  for (const line of envFileContents.split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    process.env[key] = value;
  }
}

// Valores de desarrollo. Sirven para arrancar local sin configurar nada, pero
// estan prohibidos en produccion (ver superRefine). El hash corresponde al
// password de desarrollo "mirador-dev-password".
const DEV_JWT_SECRET = 'change-me-for-local-development-only-32chars';
const DEV_CEO_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$pjmW3/dEn4AGbnpUcH6Wfg$9n5wTmLRpffddf9mtxFc2a37NJCTSpabMeASiB3CfCo';
const EXAMPLE_CORE_SERVICE_TOKEN = 'change-me-for-local-internal-core';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL_MIGRATION: z
      .url()
      .default('postgresql://postgres:postgres@localhost:5432/mirador_core'),
    DATABASE_URL_APP: z
      .url()
      .default('postgresql://mirador_app:mirador_app_dev@localhost:5432/mirador_core'),
    DATABASE_URL_READONLY: z
      .url()
      .default('postgresql://mirador_readonly:mirador_readonly_dev@localhost:5432/mirador_core'),
    CORE_SERVICE_TOKEN: z.string().min(12).optional(),
    JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
    SESSION_COOKIE_NAME: z.string().min(1).default('mirador_session'),
    // 'lax' si la web comparte dominio registrable con el core (subdominios); 'none'
    // si la web es cross-site (otro dominio). 'none' implica Secure obligatorio.
    SESSION_COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    CEO_EMAIL: z.email().default('ceo@mirador.local'),
    CEO_PASSWORD_HASH: z.string().startsWith('$argon2').default(DEV_CEO_PASSWORD_HASH),
    ANALYTICS_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    ANALYTICS_DEFAULT_LIMIT: z.coerce.number().int().positive().default(100),
    ANALYTICS_MAX_LIMIT: z.coerce.number().int().positive().default(500),
    LLM_PROVIDER: z.enum(['openai', 'stub']).default('stub'),
    OPENAI_API_KEY: z.string().min(1).optional(),
    // baseURL opcional para las llamadas a OpenAI. En produccion apunta al AI Gateway
    // de Cloudflare (cache + observabilidad + costos); si no esta, se usa api.openai.com.
    OPENAI_BASE_URL: z.url().optional(),
    ORCHESTRATOR_MODEL: z.string().min(1).default('gpt-5.2'),
    LIGHT_MODEL: z.string().min(1).default('gpt-5-mini'),
    // Solo se desactiva con el literal "false"; cualquier otro valor (o ausencia)
    // deja el fallback activo. Evita el comportamiento de z.coerce.boolean, que
    // trata "false" como true.
    FALLBACK_SQL_ENABLED: z
      .string()
      .default('true')
      .transform((value) => value.toLowerCase() !== 'false'),
    EMBEDDING_PROVIDER: z.enum(['openai', 'stub']).default('stub'),
    EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    // Secreto compartido que Cloudflare inyecta como header `x-mirador-origin`. El
    // origin guard exige que coincida en las rutas publicas (/api/*) en produccion,
    // cerrando el bypass directo al origen de Railway. Requerido en produccion.
    CLOUDFLARE_ORIGIN_SECRET: z.string().min(16).optional(),
    // Origen del frontend (mirador-web) para habilitar CORS con credenciales cuando
    // la web es cross-origin. Si no esta, CORS queda cerrado (solo same-origin).
    WEB_ORIGIN: z.url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.LLM_PROVIDER === 'openai' && value.OPENAI_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when LLM_PROVIDER is "openai".',
      });
    }

    if (value.EMBEDDING_PROVIDER === 'openai' && value.OPENAI_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when EMBEDDING_PROVIDER is "openai".',
      });
    }

    if (value.NODE_ENV !== 'production') {
      return;
    }

    if (value.JWT_SECRET === DEV_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message:
          'JWT_SECRET must be set to a strong production secret, not the development default.',
      });
    }

    if (value.CEO_PASSWORD_HASH === DEV_CEO_PASSWORD_HASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['CEO_PASSWORD_HASH'],
        message:
          'CEO_PASSWORD_HASH must be the hash of the real password in production, not the development default.',
      });
    }

    if (
      value.CORE_SERVICE_TOKEN === undefined ||
      value.CORE_SERVICE_TOKEN === EXAMPLE_CORE_SERVICE_TOKEN
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORE_SERVICE_TOKEN'],
        message: 'CORE_SERVICE_TOKEN must be set to a strong production token in production.',
      });
    }

    if (value.CLOUDFLARE_ORIGIN_SECRET === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLOUDFLARE_ORIGIN_SECRET'],
        message:
          'CLOUDFLARE_ORIGIN_SECRET must be set in production to validate that traffic comes through Cloudflare.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
