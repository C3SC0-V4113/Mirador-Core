import { PrismaClient, ExpenseArea } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { MONTH_COUNT, monthFromIndex, formatMonth, hashInt } from './helpers.js';

type ExpenseAreaDef = {
  area: ExpenseArea;
  baseAmount: string;
  growthPerQuarter: number;
  seasonalSpikes: Partial<Record<number, { amount: number; label: string }>>;
  anomalies: { monthIdx: number; amount: number; label: string }[];
};

const expenseAreas: ExpenseAreaDef[] = [
  {
    area: 'ENGINEERING',
    baseAmount: '58500.00',
    growthPerQuarter: 1200,
    seasonalSpikes: {},
    anomalies: [
      { monthIdx: 15, amount: 15000, label: 'cloud infrastructure upgrade' },
      { monthIdx: 27, amount: 8000, label: 'annual tooling licenses' },
    ],
  },
  {
    area: 'SALES',
    baseAmount: '22600.00',
    growthPerQuarter: 400,
    seasonalSpikes: {
      9: { amount: 3500, label: 'Q4 incentive program ramp-up' },
      10: { amount: 5000, label: 'Q4 sales incentive program' },
    },
    anomalies: [],
  },
  {
    area: 'MARKETING',
    baseAmount: '17800.00',
    growthPerQuarter: 300,
    seasonalSpikes: {
      2: { amount: 4000, label: 'spring industry expo booth' },
      5: { amount: 2500, label: 'summer campaign launch' },
      8: { amount: 4500, label: 'fall conference sponsorship' },
    },
    anomalies: [],
  },
  {
    area: 'SUPPORT',
    baseAmount: '14200.00',
    growthPerQuarter: 200,
    seasonalSpikes: {
      0: { amount: 1800, label: 'post-holiday support surge' },
      6: { amount: 1200, label: 'summer maintenance window' },
    },
    anomalies: [],
  },
  {
    area: 'OPERATIONS',
    baseAmount: '11800.00',
    growthPerQuarter: 150,
    seasonalSpikes: {
      0: { amount: 1500, label: 'annual compliance audit' },
      6: { amount: 2000, label: 'H2 operational review' },
    },
    anomalies: [],
  },
  {
    area: 'ADMIN',
    baseAmount: '9200.00',
    growthPerQuarter: 0,
    seasonalSpikes: {},
    anomalies: [],
  },
];

export async function seedExpenses(prisma: PrismaClient): Promise<void> {
  for (let monthIdx = 0; monthIdx < MONTH_COUNT; monthIdx++) {
    const monthStart = monthFromIndex(monthIdx);
    const calendarMonth = monthIdx % 12;

    for (const area of expenseAreas) {
      const base = new Prisma.Decimal(area.baseAmount);

      const quartersSinceStart = Math.floor(monthIdx / 3);
      const growthAmount = new Prisma.Decimal(area.growthPerQuarter * quartersSinceStart);

      const spike = area.seasonalSpikes[calendarMonth];
      const spikeAmount = spike ? new Prisma.Decimal(spike.amount) : new Prisma.Decimal(0);

      const anomalyEntry = area.anomalies.find((a) => a.monthIdx === monthIdx) ?? null;
      const anomalyAmount =
        anomalyEntry !== null ? new Prisma.Decimal(anomalyEntry.amount) : new Prisma.Decimal(0);

      const totalAmount = base.plus(growthAmount).plus(spikeAmount).plus(anomalyAmount);

      const descriptionParts: string[] = [];
      descriptionParts.push(`${area.area.toLowerCase()} operating cost`);

      if (spike && hashInt(`${area.area}-${String(monthIdx)}-spike`) % 100 < 80) {
        descriptionParts.push(`including ${spike.label}`);
      }
      if (anomalyEntry !== null) {
        descriptionParts.push(`plus ${anomalyEntry.label}`);
      }

      const externalId = `expense-${area.area.toLowerCase()}-${formatMonth(monthStart)}`;

      await prisma.expense.upsert({
        where: { externalId },
        update: {
          area: area.area,
          expenseDate: monthStart,
          amount: totalAmount,
          description: descriptionParts.join('; '),
        },
        create: {
          externalId,
          area: area.area,
          expenseDate: monthStart,
          amount: totalAmount,
          description: descriptionParts.join('; '),
        },
      });
    }
  }
}
