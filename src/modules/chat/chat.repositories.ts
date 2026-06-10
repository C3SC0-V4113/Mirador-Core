import {
  type ArtifactType,
  type ChatRole,
  type IntentMode,
  Prisma,
  type PrismaClient,
} from '@prisma/client';

export type InsertMessageInput = {
  conversationId: string;
  role: ChatRole;
  content: string;
  intentMode: IntentMode | null;
  traceId: string;
};

export type InsertArtifactInput = {
  conversationId: string;
  messageId: string;
  artifactType: ArtifactType;
  question: string;
  period: string | null;
  sourceViews: string[];
  validatedSql: string | null;
  summary: string | null;
  payload: Prisma.InputJsonValue;
  chartSpec: Prisma.InputJsonValue | null;
  freshness: string | null;
  warnings: string[];
  traceId: string;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessage: string | null;
};

export type ChatRepository = {
  ensureConversation(userId: string, conversationId: string | undefined): Promise<string>;
  insertMessage(input: InsertMessageInput): Promise<{ id: string }>;
  insertArtifact(input: InsertArtifactInput): Promise<{ id: string }>;
  listRecentMessages(
    conversationId: string,
    take?: number,
  ): Promise<{ role: ChatRole; content: string }[]>;
  listConversations(userId: string): Promise<ConversationSummary[]>;
};

export function createChatRepository(prisma: PrismaClient): ChatRepository {
  return {
    async ensureConversation(userId, conversationId) {
      if (conversationId !== undefined) {
        const existing = await prisma.conversation.findFirst({
          where: { id: conversationId, userId },
          select: { id: true },
        });

        if (existing !== null) {
          return existing.id;
        }
      }

      const created = await prisma.conversation.create({
        data: { userId },
        select: { id: true },
      });

      return created.id;
    },

    async insertMessage(input) {
      return prisma.chatMessage.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          intentMode: input.intentMode,
          traceId: input.traceId,
        },
        select: { id: true },
      });
    },

    async insertArtifact(input) {
      return prisma.chatArtifact.create({
        data: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          artifactType: input.artifactType,
          question: input.question,
          period: input.period,
          sourceViews: input.sourceViews,
          validatedSql: input.validatedSql,
          summary: input.summary,
          payload: input.payload,
          chartSpec: input.chartSpec ?? Prisma.JsonNull,
          freshness: input.freshness,
          warnings: input.warnings,
          traceId: input.traceId,
        },
        select: { id: true },
      });
    },

    async listRecentMessages(conversationId, take = 5) {
      // Traemos los mas recientes (desc) y los devolvemos en orden cronologico
      // para el prompt. Con 'asc' + take se obtenian los mas ANTIGUOS, que es lo
      // contrario a "memoria reciente".
      const rows = await prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take,
        select: { role: true, content: true },
      });

      return rows.reverse();
    },

    async listConversations(userId) {
      const conversations = await prisma.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true },
          },
        },
      });

      return conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessage: conversation.messages[0]?.content ?? null,
      }));
    },
  };
}
