import { z } from 'zod';

import { intentModeSchema } from '../chat/chat.schemas.js';

// Contrato de entrada service-to-service para /internal/core/ask. A diferencia del
// chat web, no acepta conversation_id: las llamadas del MCP son one-shot sin estado.
export const internalAskBodySchema = z.object({
  question: z.string().min(1),
  intent_mode: intentModeSchema.optional(),
});

export type InternalAskBody = z.infer<typeof internalAskBodySchema>;
