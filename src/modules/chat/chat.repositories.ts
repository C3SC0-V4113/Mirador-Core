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

export type ArtifactRecord = {
  id: string;
  artifactType: ArtifactType;
  chartSpec: unknown;
  payload: unknown;
  sourceViews: string[];
};

export type ConversationArtifactRecord = {
  id: string;
  artifactType: ArtifactType;
  summary: string | null;
  payload: unknown;
  chartSpec: unknown;
  warnings: string[];
};

export type ConversationMessageRecord = {
  id: string;
  role: ChatRole;
  content: string;
  traceId: string;
  artifacts: ConversationArtifactRecord[];
};

export type ConversationDetail = {
  id: string;
  title: string | null;
  messages: ConversationMessageRecord[];
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
  getConversationDetail(conversationId: string, userId: string): Promise<ConversationDetail | null>;
  renameConversation(conversationId: string, userId: string, title: string): Promise<boolean>;
  getArtifactForUser(artifactId: string, userId: string): Promise<ArtifactRecord | null>;
  updateArtifactChartSpec(artifactId: string, chartSpec: Prisma.InputJsonValue): Promise<void>;
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

    async getConversationDetail(conversationId, userId) {
      // El filtro por userId garantiza que el CEO solo reabre conversaciones
      // propias. Mensajes y sus artefactos en orden cronologico para rehidratar
      // el hilo tal como se vio en vivo.
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        select: {
          id: true,
          title: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              role: true,
              content: true,
              traceId: true,
              artifacts: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  artifactType: true,
                  summary: true,
                  payload: true,
                  chartSpec: true,
                  warnings: true,
                },
              },
            },
          },
        },
      });

      if (conversation === null) {
        return null;
      }

      return {
        id: conversation.id,
        title: conversation.title,
        messages: conversation.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          traceId: message.traceId,
          artifacts: message.artifacts.map((artifact) => ({
            id: artifact.id,
            artifactType: artifact.artifactType,
            summary: artifact.summary,
            payload: artifact.payload,
            chartSpec: artifact.chartSpec,
            warnings: artifact.warnings,
          })),
        })),
      };
    },

    async renameConversation(conversationId, userId, title) {
      // updateMany con filtro por userId garantiza ownership: si la conversacion
      // no es del usuario, count = 0 y no se renombra nada.
      const result = await prisma.conversation.updateMany({
        where: { id: conversationId, userId },
        data: { title },
      });

      return result.count > 0;
    },

    async getArtifactForUser(artifactId, userId) {
      // El filtro por la relacion conversation.userId garantiza que el CEO solo
      // puede tocar artefactos de sus propias conversaciones.
      return prisma.chatArtifact.findFirst({
        where: { id: artifactId, conversation: { userId } },
        select: {
          id: true,
          artifactType: true,
          chartSpec: true,
          payload: true,
          sourceViews: true,
        },
      });
    },

    async updateArtifactChartSpec(artifactId, chartSpec) {
      await prisma.chatArtifact.update({
        where: { id: artifactId },
        data: { chartSpec },
      });
    },
  };
}
