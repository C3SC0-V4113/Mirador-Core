import type { IntentMode } from '@prisma/client';
import { z } from 'zod';

export const intentModeSchema = z.enum(['responder', 'analizar', 'reporte_visual', 'plan']);

export type IntentModeInput = z.infer<typeof intentModeSchema>;

export const chatMessageBodySchema = z.object({
  message: z.string().min(1),
  conversation_id: z.uuid().optional(),
  intent_mode: intentModeSchema.optional(),
});

export type ChatMessageBody = z.infer<typeof chatMessageBodySchema>;

export function toPrismaIntentMode(mode: IntentModeInput | undefined): IntentMode | null {
  if (mode === undefined) {
    return null;
  }

  return mode.toUpperCase() as IntentMode;
}

export const SUGGESTED_QUESTIONS = [
  '¿Cómo cambió el negocio respecto al último periodo?',
  '¿Qué proyectos requieren atención?',
  '¿Qué clientes están en riesgo?',
  '¿Cómo varió el MRR en los últimos meses?',
  '¿Cuáles son los tickets críticos abiertos?',
] as const;
