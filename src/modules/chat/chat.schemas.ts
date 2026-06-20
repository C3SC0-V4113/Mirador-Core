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

export const chartEditBodySchema = z.object({
  message: z.string().min(1),
});

export type ChartEditBody = z.infer<typeof chartEditBodySchema>;

// Tipos de grafica permitidos para ediciones de SOLO visualizacion (mini-chat).
// No tocan datos; solo cambian la representacion de un artefacto ya generado.
export const VISUALIZATION_CHART_TYPES = [
  'line',
  'bar',
  'stacked_bar',
  'area',
  'pie',
  'table',
] as const;

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
