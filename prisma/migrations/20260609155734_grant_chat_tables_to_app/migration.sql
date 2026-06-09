-- Las tablas de chat las escribe el runtime (rol mirador_app); el rol read-only
-- no necesita acceso a ellas. Los GRANT no se infieren de "ALL TABLES" para
-- tablas creadas despues, asi que se otorgan explicitamente aqui. Ver ADR 0003.
GRANT SELECT, INSERT, UPDATE, DELETE ON "chat_messages", "chat_artifacts" TO mirador_app;
