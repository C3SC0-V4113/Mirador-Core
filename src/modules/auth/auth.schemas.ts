import { z } from 'zod';

export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: 'CEO';
  sessionId: string;
  tokenFamilyId: string;
};

export const jwtPayloadSchema = z.object({
  sub: z.uuid(),
  role: z.literal('CEO'),
  session_id: z.uuid(),
  token_family_id: z.uuid(),
  exp: z.number().int().positive(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
