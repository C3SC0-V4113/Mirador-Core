-- La tabla de auditoria la escribe el runtime (rol mirador_app); el rol read-only
-- no la toca. Los GRANT no se infieren de "ALL TABLES" para tablas creadas
-- despues, asi que se otorgan explicitamente aqui. Ver ADR 0003.
GRANT SELECT, INSERT ON "query_audit_log" TO mirador_app;
