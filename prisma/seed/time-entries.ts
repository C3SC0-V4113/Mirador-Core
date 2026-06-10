import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { monthIndex, formatMonth } from './helpers.js';

type RoleDef = {
  name: string;
  costRate: string;
  billRate: string;
  rampUpPct: number;
  steadyPct: number;
  windDownPct: number;
};

const roles: RoleDef[] = [
  {
    name: 'Architect',
    costRate: '135.00',
    billRate: '210.00',
    rampUpPct: 0.35,
    steadyPct: 0.2,
    windDownPct: 0.15,
  },
  {
    name: 'Engineer',
    costRate: '95.00',
    billRate: '165.00',
    rampUpPct: 0.4,
    steadyPct: 0.55,
    windDownPct: 0.45,
  },
  {
    name: 'Delivery Lead',
    costRate: '115.00',
    billRate: '190.00',
    rampUpPct: 0.25,
    steadyPct: 0.25,
    windDownPct: 0.4,
  },
];

const BASE_HOURS = 80;

type ProjectMeta = {
  externalId: string;
  startDate: Date;
  targetEndDate: Date;
  status: string;
  customerExternalId: string;
};

export async function seedTimeEntries(
  prisma: PrismaClient,
  projectByExternalId: Map<string, string>,
  projectsMeta: ProjectMeta[],
): Promise<void> {
  for (const meta of projectsMeta) {
    const projectId = projectByExternalId.get(meta.externalId);
    if (!projectId) continue;

    const startIdx = monthIndex(meta.startDate);
    const endIdx = monthIndex(meta.targetEndDate);
    const totalMonths = endIdx - startIdx + 1;

    if (totalMonths <= 0) continue;

    const rampUpEnd = Math.min(startIdx + 1, endIdx);
    const windDownStart = Math.max(startIdx, endIdx - 1);

    for (let monthIdx = startIdx; monthIdx <= endIdx; monthIdx++) {
      const monthStart = new Date(Date.UTC(2024 + Math.floor(monthIdx / 12), monthIdx % 12, 1));

      const phase =
        monthIdx <= rampUpEnd ? 'rampUp' : monthIdx >= windDownStart ? 'windDown' : 'steady';

      const totalHours =
        phase === 'rampUp'
          ? Math.round(BASE_HOURS * 0.6)
          : phase === 'windDown'
            ? Math.round(BASE_HOURS * 0.5)
            : BASE_HOURS;

      const isAtRisk = meta.status === 'AT_RISK';

      for (const role of roles) {
        const pct =
          phase === 'rampUp'
            ? role.rampUpPct
            : phase === 'windDown'
              ? role.windDownPct
              : role.steadyPct;

        let hours = Math.round(totalHours * pct * 10) / 10;

        if (isAtRisk) {
          hours = Math.round(hours * 1.35 * 10) / 10;
        }

        if (hours <= 0) continue;

        const externalId = `time-${meta.externalId}-${formatMonth(monthStart)}-${role.name.toLowerCase().replace(' ', '-')}`;

        await prisma.timeEntry.upsert({
          where: { externalId },
          update: {
            projectId,
            entryDate: monthStart,
            role: role.name,
            hours: new Prisma.Decimal(hours.toFixed(2)),
            costRate: role.costRate,
            billRate: role.billRate,
          },
          create: {
            externalId,
            projectId,
            entryDate: monthStart,
            role: role.name,
            hours: new Prisma.Decimal(hours.toFixed(2)),
            costRate: role.costRate,
            billRate: role.billRate,
          },
        });
      }
    }
  }
}
