import { env } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/shared/db/prisma.js';
import { customers } from './customers.js';
import { seedSubscriptions } from './subscriptions.js';
import { seedInvoices } from './invoices.js';
import { seedSalesOpportunities } from './opportunities.js';
import { seedProjects } from './projects.js';
import { seedTimeEntries } from './time-entries.js';
import { seedSupportTickets } from './support-tickets.js';
import { seedExpenses } from './expenses.js';

const prisma = createPrismaClient(env.DATABASE_URL_APP);

async function main() {
  await prisma.user.upsert({
    where: { email: env.CEO_EMAIL },
    update: {
      role: 'CEO',
      passwordHash: env.CEO_PASSWORD_HASH,
    },
    create: {
      email: env.CEO_EMAIL,
      role: 'CEO',
      passwordHash: env.CEO_PASSWORD_HASH,
    },
  });

  const customerByExternalId = new Map<string, string>();
  const healthScores = new Map<string, number>();

  for (const customer of customers) {
    const savedCustomer = await prisma.customer.upsert({
      where: { externalId: customer.externalId },
      update: customer,
      create: customer,
    });

    customerByExternalId.set(customer.externalId, savedCustomer.id);
    healthScores.set(customer.externalId, customer.healthScore);
  }

  await seedSubscriptions(prisma, customerByExternalId);
  await seedInvoices(prisma, customerByExternalId, healthScores);
  await seedSalesOpportunities(prisma, customerByExternalId);
  const projectByExternalId = await seedProjects(prisma, customerByExternalId);

  const projectMetas = [
    {
      externalId: 'proj-atlas-dw',
      startDate: new Date('2024-03-01'),
      targetEndDate: new Date('2024-09-30'),
      status: 'COMPLETED',
      customerExternalId: 'cust-atlas',
    },
    {
      externalId: 'proj-atlas-platform',
      startDate: new Date('2026-02-01'),
      targetEndDate: new Date('2026-09-30'),
      status: 'ACTIVE',
      customerExternalId: 'cust-atlas',
    },
    {
      externalId: 'proj-nova-integration',
      startDate: new Date('2026-01-15'),
      targetEndDate: new Date('2026-07-31'),
      status: 'AT_RISK',
      customerExternalId: 'cust-nova',
    },
    {
      externalId: 'proj-nova-route',
      startDate: new Date('2024-06-01'),
      targetEndDate: new Date('2025-01-31'),
      status: 'COMPLETED',
      customerExternalId: 'cust-nova',
    },
    {
      externalId: 'proj-pulse-ehr',
      startDate: new Date('2024-10-01'),
      targetEndDate: new Date('2025-04-30'),
      status: 'COMPLETED',
      customerExternalId: 'cust-pulse',
    },
    {
      externalId: 'proj-pulse-modernization',
      startDate: new Date('2026-03-01'),
      targetEndDate: new Date('2026-10-15'),
      status: 'ACTIVE',
      customerExternalId: 'cust-pulse',
    },
    {
      externalId: 'proj-zenith-core',
      startDate: new Date('2024-05-01'),
      targetEndDate: new Date('2024-12-31'),
      status: 'COMPLETED',
      customerExternalId: 'cust-zenith',
    },
    {
      externalId: 'proj-zenith-remediation',
      startDate: new Date('2026-02-10'),
      targetEndDate: new Date('2026-07-20'),
      status: 'AT_RISK',
      customerExternalId: 'cust-zenith',
    },
    {
      externalId: 'proj-cobalt-scale',
      startDate: new Date('2024-07-01'),
      targetEndDate: new Date('2024-12-15'),
      status: 'COMPLETED',
      customerExternalId: 'cust-cobalt',
    },
    {
      externalId: 'proj-cobalt-devops',
      startDate: new Date('2025-02-01'),
      targetEndDate: new Date('2025-06-30'),
      status: 'COMPLETED',
      customerExternalId: 'cust-cobalt',
    },
    {
      externalId: 'proj-cobalt-ai',
      startDate: new Date('2025-11-01'),
      targetEndDate: new Date('2026-04-30'),
      status: 'COMPLETED',
      customerExternalId: 'cust-cobalt',
    },
    {
      externalId: 'proj-cobalt-scalability',
      startDate: new Date('2026-05-01'),
      targetEndDate: new Date('2026-11-30'),
      status: 'ACTIVE',
      customerExternalId: 'cust-cobalt',
    },
    {
      externalId: 'proj-meridian-core',
      startDate: new Date('2024-04-01'),
      targetEndDate: new Date('2025-02-28'),
      status: 'COMPLETED',
      customerExternalId: 'cust-meridian',
    },
    {
      externalId: 'proj-apex-erp',
      startDate: new Date('2026-06-01'),
      targetEndDate: new Date('2026-12-31'),
      status: 'ACTIVE',
      customerExternalId: 'cust-apex',
    },
    {
      externalId: 'proj-solara-grid',
      startDate: new Date('2025-01-01'),
      targetEndDate: new Date('2025-08-31'),
      status: 'COMPLETED',
      customerExternalId: 'cust-solara',
    },
    {
      externalId: 'proj-solara-infra',
      startDate: new Date('2024-08-01'),
      targetEndDate: new Date('2024-12-31'),
      status: 'COMPLETED',
      customerExternalId: 'cust-solara',
    },
    {
      externalId: 'proj-vantage-digital',
      startDate: new Date('2025-06-01'),
      targetEndDate: new Date('2025-09-30'),
      status: 'CANCELED',
      customerExternalId: 'cust-vantage',
    },
    {
      externalId: 'proj-northline-pipeline',
      startDate: new Date('2025-06-01'),
      targetEndDate: new Date('2025-12-31'),
      status: 'COMPLETED',
      customerExternalId: 'cust-northline',
    },
    {
      externalId: 'proj-northline-hipaa',
      startDate: new Date('2026-08-01'),
      targetEndDate: new Date('2027-01-31'),
      status: 'PLANNED',
      customerExternalId: 'cust-northline',
    },
  ];

  await seedTimeEntries(prisma, projectByExternalId, projectMetas);
  await seedSupportTickets(prisma, customerByExternalId, healthScores);
  await seedExpenses(prisma);

  console.log(
    'mirador-core seed completed: CEO, 13 customers, 31 months of analytics data seeded.',
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
