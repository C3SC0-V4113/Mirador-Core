-- View gobernada de ingresos facturados por cliente y por mes. Habilita la
-- metrica customer_revenue del catalogo semantico. Solo lectura para el rol
-- analitico (ver ADR 0003: la migracion posee la view y su GRANT).
CREATE VIEW "ceo_customer_revenue" AS
SELECT
  date_trunc('month', i.invoice_date)::date AS period_month,
  c.name AS customer_name,
  c.segment,
  c.risk_level,
  SUM(i.amount)::numeric(12,2) AS revenue
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.status IN ('PAID', 'OPEN', 'OVERDUE')
GROUP BY date_trunc('month', i.invoice_date)::date, c.name, c.segment, c.risk_level;

GRANT SELECT ON "ceo_customer_revenue" TO mirador_readonly;
