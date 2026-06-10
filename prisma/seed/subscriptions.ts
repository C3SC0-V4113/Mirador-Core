import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { requireId } from './helpers.js';

type SubscriptionRow = {
  externalId: string;
  customerExternalId: string;
  planName: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELED';
  monthlyAmount: string;
  startedAt: string;
  endedAt: string | null;
};

const subscriptions: SubscriptionRow[] = [
  {
    externalId: 'sub-atlas',
    customerExternalId: 'cust-atlas',
    planName: 'Executive Suite',
    status: 'ACTIVE',
    monthlyAmount: '15500.00',
    startedAt: '2024-01-01',
    endedAt: null,
  },
  {
    externalId: 'sub-nova',
    customerExternalId: 'cust-nova',
    planName: 'Growth Suite',
    status: 'CANCELED',
    monthlyAmount: '9200.00',
    startedAt: '2024-01-01',
    endedAt: '2025-06-30',
  },
  {
    externalId: 'sub-nova-downgrade',
    customerExternalId: 'cust-nova',
    planName: 'Startup Core',
    status: 'ACTIVE',
    monthlyAmount: '5500.00',
    startedAt: '2025-07-01',
    endedAt: null,
  },
  {
    externalId: 'sub-pulse',
    customerExternalId: 'cust-pulse',
    planName: 'Executive Suite',
    status: 'ACTIVE',
    monthlyAmount: '13200.00',
    startedAt: '2024-01-01',
    endedAt: null,
  },
  {
    externalId: 'sub-zenith',
    customerExternalId: 'cust-zenith',
    planName: 'Enterprise Core',
    status: 'CANCELED',
    monthlyAmount: '17800.00',
    startedAt: '2024-01-01',
    endedAt: '2026-06-30',
  },
  {
    externalId: 'sub-cobalt',
    customerExternalId: 'cust-cobalt',
    planName: 'Startup Core',
    status: 'CANCELED',
    monthlyAmount: '4800.00',
    startedAt: '2024-01-01',
    endedAt: '2025-12-31',
  },
  {
    externalId: 'sub-cobalt-upgrade',
    customerExternalId: 'cust-cobalt',
    planName: 'Growth Suite',
    status: 'ACTIVE',
    monthlyAmount: '9800.00',
    startedAt: '2026-01-01',
    endedAt: null,
  },
  {
    externalId: 'sub-meridian',
    customerExternalId: 'cust-meridian',
    planName: 'Enterprise Core',
    status: 'ACTIVE',
    monthlyAmount: '22500.00',
    startedAt: '2024-01-01',
    endedAt: null,
  },
  {
    externalId: 'sub-apex',
    customerExternalId: 'cust-apex',
    planName: 'Startup Core',
    status: 'CANCELED',
    monthlyAmount: '5200.00',
    startedAt: '2025-01-01',
    endedAt: '2025-05-31',
  },
  {
    externalId: 'sub-apex-upgrade',
    customerExternalId: 'cust-apex',
    planName: 'Growth Suite',
    status: 'ACTIVE',
    monthlyAmount: '8400.00',
    startedAt: '2025-06-01',
    endedAt: null,
  },
  {
    externalId: 'sub-solara',
    customerExternalId: 'cust-solara',
    planName: 'Growth Suite',
    status: 'ACTIVE',
    monthlyAmount: '9600.00',
    startedAt: '2024-06-01',
    endedAt: null,
  },
  {
    externalId: 'sub-dovetail',
    customerExternalId: 'cust-dovetail',
    planName: 'Executive Suite',
    status: 'ACTIVE',
    monthlyAmount: '16200.00',
    startedAt: '2024-01-01',
    endedAt: null,
  },
  {
    externalId: 'sub-prism',
    customerExternalId: 'cust-prism',
    planName: 'Startup Core',
    status: 'ACTIVE',
    monthlyAmount: '3600.00',
    startedAt: '2024-03-01',
    endedAt: null,
  },
  {
    externalId: 'sub-riverbend',
    customerExternalId: 'cust-riverbend',
    planName: 'Growth Suite',
    status: 'CANCELED',
    monthlyAmount: '8800.00',
    startedAt: '2024-01-01',
    endedAt: '2026-03-31',
  },
  {
    externalId: 'sub-riverbend-downgrade',
    customerExternalId: 'cust-riverbend',
    planName: 'Startup Core',
    status: 'ACTIVE',
    monthlyAmount: '4400.00',
    startedAt: '2026-04-01',
    endedAt: null,
  },
  {
    externalId: 'sub-vantage',
    customerExternalId: 'cust-vantage',
    planName: 'Growth Suite',
    status: 'CANCELED',
    monthlyAmount: '7800.00',
    startedAt: '2024-01-01',
    endedAt: '2025-12-15',
  },
  {
    externalId: 'sub-northline',
    customerExternalId: 'cust-northline',
    planName: 'Growth Suite',
    status: 'ACTIVE',
    monthlyAmount: '7200.00',
    startedAt: '2025-03-01',
    endedAt: null,
  },
];

export type SubscriptionInfo = {
  externalId: string;
  monthlyAmount: Prisma.Decimal;
  startedAt: Date;
  endedAt: Date | null;
};

export function getActiveSubscriptionAt(
  customerExternalId: string,
  date: Date,
): SubscriptionInfo | null {
  const customerSubscriptions = subscriptions.filter(
    (s) => s.customerExternalId === customerExternalId,
  );

  for (const sub of customerSubscriptions) {
    const start = new Date(sub.startedAt);
    const end = sub.endedAt ? new Date(sub.endedAt) : null;

    if (date >= start && (end === null || date <= end)) {
      return {
        externalId: sub.externalId,
        monthlyAmount: new Prisma.Decimal(sub.monthlyAmount),
        startedAt: start,
        endedAt: end,
      };
    }
  }

  return null;
}

export async function seedSubscriptions(
  prisma: PrismaClient,
  customerByExternalId: Map<string, string>,
): Promise<void> {
  for (const sub of subscriptions) {
    const customerId = requireId(customerByExternalId, sub.customerExternalId);

    await prisma.subscription.upsert({
      where: { externalId: sub.externalId },
      update: {
        customerId,
        planName: sub.planName,
        status: sub.status,
        monthlyAmount: sub.monthlyAmount,
        startedAt: new Date(sub.startedAt),
        endedAt: sub.endedAt ? new Date(sub.endedAt) : null,
      },
      create: {
        externalId: sub.externalId,
        customerId,
        planName: sub.planName,
        status: sub.status,
        monthlyAmount: sub.monthlyAmount,
        startedAt: new Date(sub.startedAt),
        endedAt: sub.endedAt ? new Date(sub.endedAt) : null,
      },
    });
  }
}
