import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  MONTH_COUNT,
  monthFromIndex,
  addDays,
  formatMonth,
  requireId,
  hashInt,
} from './helpers.js';
import { getActiveSubscriptionAt } from './subscriptions.js';
import { customers } from './customers.js';

type InvoiceParams = {
  growthPerQuarter: number;
  seasonalBonus: Record<number, number>;
  expansionStart: number | null;
  expansionAmount: number;
  discountStart: number | null;
  discountEnd: number | null;
  discountRate: number;
};

const invoiceParams: Record<string, InvoiceParams> = {
  'cust-atlas': {
    growthPerQuarter: 500,
    seasonalBonus: { 10: 2500, 11: 4000 },
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-nova': {
    growthPerQuarter: 0,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-pulse': {
    growthPerQuarter: 300,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: 0,
    discountEnd: 5,
    discountRate: 0.1,
  },
  'cust-zenith': {
    growthPerQuarter: 0,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-cobalt': {
    growthPerQuarter: 800,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-meridian': {
    growthPerQuarter: 200,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-apex': {
    growthPerQuarter: 100,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: 0,
    discountEnd: 2,
    discountRate: 0.15,
  },
  'cust-solara': {
    growthPerQuarter: 400,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-dovetail': {
    growthPerQuarter: 100,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-prism': {
    growthPerQuarter: 0,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-riverbend': {
    growthPerQuarter: 0,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-vantage': {
    growthPerQuarter: 200,
    seasonalBonus: { 10: 2800, 11: 4200 },
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
  'cust-northline': {
    growthPerQuarter: 100,
    seasonalBonus: {},
    expansionStart: null,
    expansionAmount: 0,
    discountStart: null,
    discountEnd: null,
    discountRate: 0,
  },
};

function determineStatus(
  customerId: string,
  monthIdx: number,
  healthScore: number,
): 'PAID' | 'OPEN' | 'OVERDUE' | 'VOID' {
  if (customerId === 'cust-zenith') {
    if (monthIdx >= 24) return 'VOID';
    if (monthIdx >= 20) return 'OVERDUE';
  }
  if (customerId === 'cust-vantage') {
    if (monthIdx >= 23) return 'VOID';
    if (monthIdx >= 20) return 'OVERDUE';
  }
  if (customerId === 'cust-riverbend') {
    if (monthIdx >= 6 && (monthIdx - 6) % 3 === 0) return 'OVERDUE';
  }

  const seed = `${customerId}-${String(monthIdx)}`;
  const val = hashInt(seed) % 100;

  if (healthScore >= 80) {
    if (val < 90) return 'PAID';
    return 'PAID';
  }
  if (healthScore >= 60) {
    if (val < 65) return 'PAID';
    if (val < 80) return 'OPEN';
    if (val < 95) return 'OVERDUE';
    return 'VOID';
  }
  if (val < 25) return 'PAID';
  if (val < 45) return 'OPEN';
  if (val < 85) return 'OVERDUE';
  return 'VOID';
}

export async function seedInvoices(
  prisma: PrismaClient,
  customerByExternalId: Map<string, string>,
  healthScores: Map<string, number>,
): Promise<void> {
  for (let monthIdx = 0; monthIdx < MONTH_COUNT; monthIdx++) {
    const monthStart = monthFromIndex(monthIdx);

    for (const customer of customers) {
      const params = invoiceParams[customer.externalId];

      const custId = requireId(customerByExternalId, customer.externalId);

      const activeSub = getActiveSubscriptionAt(customer.externalId, monthStart);
      if (!activeSub) continue;

      const quartersSinceStart = Math.floor(monthIdx / 3);
      const growthAmount = new Prisma.Decimal(params.growthPerQuarter * quartersSinceStart);

      const seasonalAmount = new Prisma.Decimal(params.seasonalBonus[monthIdx % 12] ?? 0);

      const expansion =
        params.expansionStart !== null && monthIdx >= params.expansionStart
          ? new Prisma.Decimal(params.expansionAmount)
          : new Prisma.Decimal(0);

      const inDiscountPeriod =
        params.discountStart !== null &&
        params.discountEnd !== null &&
        monthIdx >= params.discountStart &&
        monthIdx <= params.discountEnd;

      const subtotal = activeSub.monthlyAmount
        .plus(growthAmount)
        .plus(seasonalAmount)
        .plus(expansion);

      const discountMultiplier = inDiscountPeriod
        ? new Prisma.Decimal(1 - params.discountRate)
        : new Prisma.Decimal(1);

      const amount = subtotal.mul(discountMultiplier);

      if (amount.lessThanOrEqualTo(0)) continue;

      const healthScore = healthScores.get(customer.externalId) ?? 50;
      const status = determineStatus(customer.externalId, monthIdx, healthScore);

      const externalId = `inv-${customer.externalId}-${formatMonth(monthStart)}`;

      await prisma.invoice.upsert({
        where: { externalId },
        update: {
          customerId: custId,
          invoiceDate: monthStart,
          dueDate: addDays(monthStart, 15),
          paidAt: status === 'PAID' ? addDays(monthStart, 10) : null,
          amount,
          status,
        },
        create: {
          externalId,
          customerId: custId,
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
