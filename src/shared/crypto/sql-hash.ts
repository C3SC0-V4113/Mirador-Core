import { createHash } from 'node:crypto';

// Hash estable para auditar SQL/textos sin depender de su forma exacta (dedup,
// integridad, correlacion). No es reversible: util cuando no se quiere persistir
// el texto crudo o para agrupar consultas equivalentes.
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
