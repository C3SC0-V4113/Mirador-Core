import { Prisma } from '@prisma/client';

import { env } from '../src/config/env.js';
import { createPrismaClient } from '../src/shared/db/prisma.js';

const prisma = createPrismaClient(env.DATABASE_URL_APP);

const customers = [
  {
    externalId: 'cust-atlas',
    name: 'Atlas Retail',
    segment: 'Enterprise',
    industry: 'Retail',
    healthScore: 88,
    riskLevel: 'low',
  },
  {
    externalId: 'cust-nova',
    name: 'Nova Logistics',
    segment: 'Mid Market',
    industry: 'Logistics',
    healthScore: 73,
    riskLevel: 'medium',
  },
  {
    externalId: 'cust-pulse',
    name: 'Pulse Health',
    segment: 'Enterprise',
    industry: 'Healthcare',
    healthScore: 61,
    riskLevel: 'medium',
  },
  {
    externalId: 'cust-zenith',
    name: 'Zenith Finance',
    segment: 'Enterprise',
    industry: 'Fintech',
    healthScore: 42,
    riskLevel: 'high',
  },
  {
    externalId: 'cust-cobalt',
    name: 'Cobalt SaaS',
    segment: 'Startup',
    industry: 'Software',
    healthScore: 55,
    riskLevel: 'high',
  },
] as const;

const monthStarts = Array.from({ length: 18 }, (_value, index) => {
  const monthIndex = index + 1;
  return new Date(Date.UTC(2025, monthIndex, 1));
});

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

  for (const customer of customers) {
    const savedCustomer = await prisma.customer.upsert({
      where: { externalId: customer.externalId },
      update: customer,
      create: customer,
    });

    customerByExternalId.set(customer.externalId, savedCustomer.id);
  }

  await seedSubscriptions(customerByExternalId);
  await seedInvoices(customerByExternalId);
  await seedSalesOpportunities(customerByExternalId);
  const projectByExternalId = await seedProjects(customerByExternalId);
  await seedTimeEntries(projectByExternalId);
  await seedSupportTickets(customerByExternalId);
  await seedExpenses();

  console.log(
    'mirador-core seed completed: CEO, synthetic MVP data and analytics source tables are ready.',
  );
}

async function seedSubscriptions(customerByExternalId: Map<string, string>) {
  const subscriptions = [
    ['sub-atlas', 'cust-atlas', 'Executive Suite', 'ACTIVE', '15500.00', '2024-08-01'],
    ['sub-nova', 'cust-nova', 'Growth Suite', 'ACTIVE', '9200.00', '2024-11-01'],
    ['sub-pulse', 'cust-pulse', 'Executive Suite', 'ACTIVE', '13200.00', '2024-09-01'],
    ['sub-zenith', 'cust-zenith', 'Enterprise Core', 'PAUSED', '17800.00', '2024-07-01'],
    ['sub-cobalt', 'cust-cobalt', 'Startup Core', 'ACTIVE', '4800.00', '2025-01-01'],
  ] as const;

  for (const [
    externalId,
    customerExternalId,
    planName,
    status,
    monthlyAmount,
    startedAt,
  ] of subscriptions) {
    await prisma.subscription.upsert({
      where: { externalId },
      update: {
        customerId: requireId(customerByExternalId, customerExternalId),
        planName,
        status,
        monthlyAmount,
        startedAt: new Date(startedAt),
        endedAt: null,
      },
      create: {
        externalId,
        customerId: requireId(customerByExternalId, customerExternalId),
        planName,
        status,
        monthlyAmount,
        startedAt: new Date(startedAt),
        endedAt: null,
      },
    });
  }
}

async function seedInvoices(customerByExternalId: Map<string, string>) {
  const baseAmounts = new Map([
    ['cust-atlas', new Prisma.Decimal('15500.00')],
    ['cust-nova', new Prisma.Decimal('9200.00')],
    ['cust-pulse', new Prisma.Decimal('13200.00')],
    ['cust-zenith', new Prisma.Decimal('17800.00')],
    ['cust-cobalt', new Prisma.Decimal('4800.00')],
  ]);

  for (const monthStart of monthStarts) {
    for (const customer of customers) {
      const baseAmount = baseAmounts.get(customer.externalId);

      if (baseAmount === undefined) {
        continue;
      }

      const month = monthStart.getUTCMonth() + 1;
      const anomalyDiscount =
        customer.externalId === 'cust-zenith' && month >= 3 && month <= 5
          ? new Prisma.Decimal('0.35')
          : new Prisma.Decimal('0');
      const expansion =
        customer.externalId === 'cust-atlas' && month >= 8
          ? new Prisma.Decimal('2200.00')
          : new Prisma.Decimal('0');
      const amount = baseAmount.plus(expansion).minus(baseAmount.mul(anomalyDiscount));
      const status = customer.externalId === 'cust-zenith' && month >= 4 ? 'OVERDUE' : 'PAID';

      await prisma.invoice.upsert({
        where: { externalId: `inv-${customer.externalId}-${formatMonth(monthStart)}` },
        update: {
          customerId: requireId(customerByExternalId, customer.externalId),
          invoiceDate: monthStart,
          dueDate: addDays(monthStart, 15),
          paidAt: status === 'PAID' ? addDays(monthStart, 10) : null,
          amount,
          status,
        },
        create: {
          externalId: `inv-${customer.externalId}-${formatMonth(monthStart)}`,
          customerId: requireId(customerByExternalId, customer.externalId),
          invoiceDate: monthStart,
          dueDate: addDays(monthStart, 15),
          paidAt: status === 'PAID' ? addDays(monthStart, 10) : null,
          amount,
          status,
        },
      });
    }
  }
}

async function seedSalesOpportunities(customerByExternalId: Map<string, string>) {
  const opportunities = [
    [
      'opp-atlas-ai',
      'cust-atlas',
      'AI Delivery Expansion',
      'NEGOTIATION',
      '64000.00',
      75,
      '2026-07-20',
    ],
    ['opp-nova-ops', 'cust-nova', 'Operations Analytics', 'PROPOSAL', '38000.00', 55, '2026-08-05'],
    ['opp-pulse-risk', 'cust-pulse', 'Risk Forecasting', 'QUALIFIED', '52000.00', 45, '2026-08-28'],
    [
      'opp-cobalt-retainer',
      'cust-cobalt',
      'Retention Retainer',
      'PROSPECTING',
      '18000.00',
      25,
      '2026-09-12',
    ],
  ] as const;

  for (const [
    externalId,
    customerExternalId,
    name,
    stage,
    amount,
    probability,
    expectedClose,
  ] of opportunities) {
    await prisma.salesOpportunity.upsert({
      where: { externalId },
      update: {
        customerId: requireId(customerByExternalId, customerExternalId),
        name,
        stage,
        amount,
        probability,
        expectedClose: new Date(expectedClose),
      },
      create: {
        externalId,
        customerId: requireId(customerByExternalId, customerExternalId),
        name,
        stage,
        amount,
        probability,
        expectedClose: new Date(expectedClose),
      },
    });
  }
}

async function seedProjects(customerByExternalId: Map<string, string>) {
  const projects = [
    [
      'proj-atlas-platform',
      'cust-atlas',
      'Executive Analytics Platform',
      'ACTIVE',
      '125000.00',
      '82000.00',
      '2026-02-01',
      '2026-09-30',
    ],
    [
      'proj-nova-integration',
      'cust-nova',
      'Logistics Integration',
      'AT_RISK',
      '78000.00',
      '72000.00',
      '2026-01-15',
      '2026-07-31',
    ],
    [
      'proj-pulse-modernization',
      'cust-pulse',
      'Data Modernization',
      'ACTIVE',
      '94000.00',
      '64000.00',
      '2026-03-01',
      '2026-10-15',
    ],
    [
      'proj-zenith-remediation',
      'cust-zenith',
      'Finance Risk Remediation',
      'AT_RISK',
      '68000.00',
      '66000.00',
      '2026-02-10',
      '2026-07-20',
    ],
  ] as const;
  const projectByExternalId = new Map<string, string>();

  for (const [
    externalId,
    customerExternalId,
    name,
    status,
    budget,
    estimatedCost,
    startDate,
    targetEndDate,
  ] of projects) {
    const project = await prisma.project.upsert({
      where: { externalId },
      update: {
        customerId: requireId(customerByExternalId, customerExternalId),
        name,
        status,
        budget,
        estimatedCost,
        startDate: new Date(startDate),
        targetEndDate: new Date(targetEndDate),
      },
      create: {
        externalId,
        customerId: requireId(customerByExternalId, customerExternalId),
        name,
        status,
        budget,
        estimatedCost,
        startDate: new Date(startDate),
        targetEndDate: new Date(targetEndDate),
      },
    });

    projectByExternalId.set(externalId, project.id);
  }

  return projectByExternalId;
}

async function seedTimeEntries(projectByExternalId: Map<string, string>) {
  const roles = [
    ['Architect', '135.00', '210.00'],
    ['Engineer', '95.00', '165.00'],
    ['Delivery Lead', '115.00', '190.00'],
  ] as const;

  for (const monthStart of monthStarts.slice(8)) {
    for (const [projectExternalId, projectId] of projectByExternalId) {
      for (const [role, costRate, billRate] of roles) {
        const riskMultiplier =
          projectExternalId.includes('zenith') || projectExternalId.includes('nova') ? 1.35 : 1;
        const hours = new Prisma.Decimal((28 * riskMultiplier).toFixed(2));
        const externalId = `time-${projectExternalId}-${formatMonth(monthStart)}-${role.toLowerCase().replace(' ', '-')}`;

        await prisma.timeEntry.upsert({
          where: { externalId },
          update: {
            projectId,
            entryDate: monthStart,
            role,
            hours,
            costRate,
            billRate,
          },
          create: {
            externalId,
            projectId,
            entryDate: monthStart,
            role,
            hours,
            costRate,
            billRate,
          },
        });
      }
    }
  }
}

async function seedSupportTickets(customerByExternalId: Map<string, string>) {
  const tickets = [
    [
      'ticket-zenith-crit-1',
      'cust-zenith',
      '2026-05-20T14:00:00.000Z',
      null,
      'CRITICAL',
      'OPEN',
      true,
      'Payment feed intermittently fails',
    ],
    [
      'ticket-zenith-high-1',
      'cust-zenith',
      '2026-05-28T09:00:00.000Z',
      null,
      'HIGH',
      'IN_PROGRESS',
      true,
      'Executive report timeout',
    ],
    [
      'ticket-cobalt-crit-1',
      'cust-cobalt',
      '2026-06-01T16:00:00.000Z',
      null,
      'CRITICAL',
      'OPEN',
      false,
      'Billing sync blocked',
    ],
    [
      'ticket-pulse-med-1',
      'cust-pulse',
      '2026-04-13T10:00:00.000Z',
      '2026-04-14T13:00:00.000Z',
      'MEDIUM',
      'RESOLVED',
      false,
      'Dashboard export issue',
    ],
    [
      'ticket-atlas-low-1',
      'cust-atlas',
      '2026-03-04T08:30:00.000Z',
      '2026-03-04T12:00:00.000Z',
      'LOW',
      'CLOSED',
      false,
      'Minor copy update',
    ],
  ] as const;

  for (const [
    externalId,
    customerExternalId,
    openedAt,
    resolvedAt,
    priority,
    status,
    slaBreached,
    subject,
  ] of tickets) {
    await prisma.supportTicket.upsert({
      where: { externalId },
      update: {
        customerId: requireId(customerByExternalId, customerExternalId),
        openedAt: new Date(openedAt),
        resolvedAt: resolvedAt === null ? null : new Date(resolvedAt),
        priority,
        status,
        slaBreached,
        subject,
      },
      create: {
        externalId,
        customerId: requireId(customerByExternalId, customerExternalId),
        openedAt: new Date(openedAt),
        resolvedAt: resolvedAt === null ? null : new Date(resolvedAt),
        priority,
        status,
        slaBreached,
        subject,
      },
    });
  }
}

async function seedExpenses() {
  const areaAmounts = [
    ['ENGINEERING', '58500.00'],
    ['SALES', '22600.00'],
    ['MARKETING', '17800.00'],
    ['SUPPORT', '14200.00'],
    ['OPERATIONS', '11800.00'],
    ['ADMIN', '9200.00'],
  ] as const;

  for (const monthStart of monthStarts) {
    for (const [area, amount] of areaAmounts) {
      const anomaly =
        area === 'ENGINEERING' && monthStart.getUTCMonth() >= 3
          ? new Prisma.Decimal('9500.00')
          : new Prisma.Decimal('0');
      const finalAmount = new Prisma.Decimal(amount).plus(anomaly);
      const externalId = `expense-${area.toLowerCase()}-${formatMonth(monthStart)}`;

      await prisma.expense.upsert({
        where: { externalId },
        update: {
          area,
          expenseDate: monthStart,
          amount: finalAmount,
          description: `${area.toLowerCase()} operating cost`,
        },
        create: {
          externalId,
          area,
          expenseDate: monthStart,
          amount: finalAmount,
          description: `${area.toLowerCase()} operating cost`,
        },
      });
    }
  }
}

function requireId(values: Map<string, string>, key: string) {
  const value = values.get(key);

  if (value === undefined) {
    throw new Error(`Missing seeded id for ${key}.`);
  }

  return value;
}

function formatMonth(date: Date) {
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);

  return result;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
