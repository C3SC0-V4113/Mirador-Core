-- Extensiones y roles (con credenciales) se aprovisionan fuera de esta migracion:
-- docker/postgres/init/* en local y un paso gestionado por entorno en produccion.
-- Esta migracion solo posee objetos de schema y los GRANT sobre ellos. Ver ADR 0003.

CREATE TYPE "UserRole" AS ENUM ('CEO');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELED');
CREATE TYPE "InvoiceStatus" AS ENUM ('PAID', 'OPEN', 'OVERDUE', 'VOID');
CREATE TYPE "OpportunityStage" AS ENUM (
  'PROSPECTING',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST'
);
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'AT_RISK', 'COMPLETED', 'CANCELED');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "ExpenseArea" AS ENUM ('ENGINEERING', 'SALES', 'MARKETING', 'SUPPORT', 'OPERATIONS', 'ADMIN');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'CEO',
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_family_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "title" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "industry" TEXT NOT NULL,
  "health_score" INTEGER NOT NULL,
  "risk_level" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customers_health_score_check" CHECK ("health_score" BETWEEN 0 AND 100)
);

CREATE TABLE "subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "plan_name" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL,
  "monthly_amount" NUMERIC(12,2) NOT NULL,
  "started_at" DATE NOT NULL,
  "ended_at" DATE,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "invoice_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "paid_at" DATE,
  "amount" NUMERIC(12,2) NOT NULL,
  "status" "InvoiceStatus" NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "sales_opportunities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "stage" "OpportunityStage" NOT NULL,
  "amount" NUMERIC(12,2) NOT NULL,
  "probability" INTEGER NOT NULL,
  "expected_close" DATE NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_opportunities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_opportunities_probability_check" CHECK ("probability" BETWEEN 0 AND 100),
  CONSTRAINT "sales_opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "projects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ProjectStatus" NOT NULL,
  "budget" NUMERIC(12,2) NOT NULL,
  "estimated_cost" NUMERIC(12,2) NOT NULL,
  "start_date" DATE NOT NULL,
  "target_end_date" DATE NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "time_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "project_id" UUID NOT NULL,
  "entry_date" DATE NOT NULL,
  "role" TEXT NOT NULL,
  "hours" NUMERIC(8,2) NOT NULL,
  "cost_rate" NUMERIC(10,2) NOT NULL,
  "bill_rate" NUMERIC(10,2) NOT NULL,
  CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "support_tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "opened_at" TIMESTAMPTZ NOT NULL,
  "resolved_at" TIMESTAMPTZ,
  "priority" "TicketPriority" NOT NULL,
  "status" "TicketStatus" NOT NULL,
  "sla_breached" BOOLEAN NOT NULL DEFAULT false,
  "subject" TEXT NOT NULL,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "expenses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_id" TEXT NOT NULL,
  "area" "ExpenseArea" NOT NULL,
  "expense_date" DATE NOT NULL,
  "amount" NUMERIC(12,2) NOT NULL,
  "description" TEXT NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_token_family_id_idx" ON "sessions"("token_family_id");
CREATE INDEX "conversations_user_id_idx" ON "conversations"("user_id");
CREATE UNIQUE INDEX "customers_external_id_key" ON "customers"("external_id");
CREATE UNIQUE INDEX "subscriptions_external_id_key" ON "subscriptions"("external_id");
CREATE INDEX "subscriptions_customer_id_idx" ON "subscriptions"("customer_id");
CREATE UNIQUE INDEX "invoices_external_id_key" ON "invoices"("external_id");
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");
CREATE INDEX "invoices_invoice_date_idx" ON "invoices"("invoice_date");
CREATE UNIQUE INDEX "sales_opportunities_external_id_key" ON "sales_opportunities"("external_id");
CREATE INDEX "sales_opportunities_customer_id_idx" ON "sales_opportunities"("customer_id");
CREATE INDEX "sales_opportunities_stage_idx" ON "sales_opportunities"("stage");
CREATE UNIQUE INDEX "projects_external_id_key" ON "projects"("external_id");
CREATE INDEX "projects_customer_id_idx" ON "projects"("customer_id");
CREATE INDEX "projects_status_idx" ON "projects"("status");
CREATE UNIQUE INDEX "time_entries_external_id_key" ON "time_entries"("external_id");
CREATE INDEX "time_entries_project_id_idx" ON "time_entries"("project_id");
CREATE INDEX "time_entries_entry_date_idx" ON "time_entries"("entry_date");
CREATE UNIQUE INDEX "support_tickets_external_id_key" ON "support_tickets"("external_id");
CREATE INDEX "support_tickets_customer_id_idx" ON "support_tickets"("customer_id");
CREATE INDEX "support_tickets_opened_at_idx" ON "support_tickets"("opened_at");
CREATE UNIQUE INDEX "expenses_external_id_key" ON "expenses"("external_id");
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");

CREATE VIEW "ceo_revenue_summary" AS
SELECT
  date_trunc('month', i.invoice_date)::date AS period_month,
  SUM(i.amount)::numeric(12,2) AS revenue,
  SUM(CASE WHEN s.status = 'ACTIVE' THEN s.monthly_amount ELSE 0 END)::numeric(12,2) AS mrr,
  (SUM(CASE WHEN s.status = 'ACTIVE' THEN s.monthly_amount ELSE 0 END) * 12)::numeric(12,2) AS arr,
  COUNT(DISTINCT i.customer_id)::integer AS paying_customers
FROM invoices i
JOIN subscriptions s ON s.customer_id = i.customer_id
WHERE i.status IN ('PAID', 'OPEN', 'OVERDUE')
GROUP BY date_trunc('month', i.invoice_date)::date;

CREATE VIEW "ceo_customer_health" AS
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  c.segment,
  c.industry,
  c.health_score,
  c.risk_level,
  COALESCE(SUM(s.monthly_amount) FILTER (WHERE s.status = 'ACTIVE'), 0)::numeric(12,2) AS active_mrr,
  COUNT(t.id) FILTER (WHERE t.status IN ('OPEN', 'IN_PROGRESS') AND t.priority IN ('HIGH', 'CRITICAL'))::integer AS critical_open_tickets
FROM customers c
LEFT JOIN subscriptions s ON s.customer_id = c.id
LEFT JOIN support_tickets t ON t.customer_id = c.id
GROUP BY c.id, c.name, c.segment, c.industry, c.health_score, c.risk_level;

CREATE VIEW "ceo_sales_pipeline" AS
SELECT
  stage,
  COUNT(*)::integer AS opportunity_count,
  SUM(amount)::numeric(12,2) AS pipeline_amount,
  SUM(amount * probability / 100)::numeric(12,2) AS forecast_amount,
  MIN(expected_close) AS next_expected_close
FROM sales_opportunities
WHERE stage NOT IN ('CLOSED_WON', 'CLOSED_LOST')
GROUP BY stage;

CREATE VIEW "ceo_project_margin" AS
SELECT
  p.id AS project_id,
  p.name AS project_name,
  c.name AS customer_name,
  p.status,
  p.budget,
  p.estimated_cost,
  COALESCE(SUM(te.hours * te.cost_rate), 0)::numeric(12,2) AS actual_cost,
  (p.budget - COALESCE(SUM(te.hours * te.cost_rate), 0))::numeric(12,2) AS margin_amount,
  CASE
    WHEN p.budget = 0 THEN 0
    ELSE ROUND(((p.budget - COALESCE(SUM(te.hours * te.cost_rate), 0)) / p.budget) * 100, 2)
  END AS margin_percent
FROM projects p
JOIN customers c ON c.id = p.customer_id
LEFT JOIN time_entries te ON te.project_id = p.id
GROUP BY p.id, p.name, c.name, p.status, p.budget, p.estimated_cost;

CREATE VIEW "ceo_delivery_risk" AS
SELECT
  p.id AS project_id,
  p.name AS project_name,
  c.name AS customer_name,
  p.status,
  p.target_end_date,
  CASE
    WHEN p.status = 'AT_RISK' THEN 'high'
    WHEN p.target_end_date < CURRENT_DATE + INTERVAL '30 days'
      AND COALESCE(SUM(te.hours * te.cost_rate), 0) > p.estimated_cost * 0.85 THEN 'medium'
    ELSE 'low'
  END AS delivery_risk,
  COALESCE(SUM(te.hours), 0)::numeric(10,2) AS hours_logged
FROM projects p
JOIN customers c ON c.id = p.customer_id
LEFT JOIN time_entries te ON te.project_id = p.id
WHERE p.status IN ('PLANNED', 'ACTIVE', 'AT_RISK')
GROUP BY p.id, p.name, c.name, p.status, p.target_end_date, p.estimated_cost;

CREATE VIEW "ceo_support_health" AS
SELECT
  date_trunc('month', opened_at)::date AS period_month,
  priority,
  COUNT(*)::integer AS ticket_count,
  COUNT(*) FILTER (WHERE sla_breached)::integer AS breached_sla_count,
  COUNT(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS'))::integer AS open_ticket_count,
  AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, CURRENT_TIMESTAMP) - opened_at)) / 3600)::numeric(10,2) AS avg_resolution_hours
FROM support_tickets
GROUP BY date_trunc('month', opened_at)::date, priority;

CREATE VIEW "ceo_financial_runway" AS
SELECT
  date_trunc('month', e.expense_date)::date AS period_month,
  SUM(e.amount)::numeric(12,2) AS total_expenses,
  SUM(e.amount) FILTER (WHERE e.area = 'ENGINEERING')::numeric(12,2) AS engineering_costs,
  SUM(e.amount) FILTER (WHERE e.area = 'SALES')::numeric(12,2) AS sales_costs,
  SUM(e.amount) FILTER (WHERE e.area = 'MARKETING')::numeric(12,2) AS marketing_costs,
  SUM(e.amount) FILTER (WHERE e.area = 'SUPPORT')::numeric(12,2) AS support_costs,
  SUM(e.amount) FILTER (WHERE e.area IN ('OPERATIONS', 'ADMIN'))::numeric(12,2) AS operating_costs,
  ROUND((250000 - SUM(e.amount)) / NULLIF(SUM(e.amount) / 30, 0), 2) AS runway_days
FROM expenses e
GROUP BY date_trunc('month', e.expense_date)::date;

GRANT CONNECT ON DATABASE mirador_core TO mirador_app, mirador_readonly;
GRANT USAGE ON SCHEMA public TO mirador_app, mirador_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mirador_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mirador_app;
GRANT SELECT ON
  ceo_revenue_summary,
  ceo_customer_health,
  ceo_sales_pipeline,
  ceo_project_margin,
  ceo_delivery_risk,
  ceo_support_health,
  ceo_financial_runway
TO mirador_readonly;
