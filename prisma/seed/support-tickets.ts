import { PrismaClient } from '@prisma/client';
import {
  MONTH_COUNT,
  monthFromIndex,
  addHours,
  requireId,
  hashInt,
  deterministicChoice,
} from './helpers.js';
import { customers } from './customers.js';

const ticketSubjects: Record<string, readonly string[]> = {
  Retail: [
    'POS data sync failure',
    'Inventory dashboard timeout',
    'Sales report mismatch',
    'Customer data export error',
    'BI tool login issue',
    'Real-time pricing update delay',
    'Store-level analytics broken',
    'Payment gateway reporting issue',
  ],
  Logistics: [
    'Route optimization not updating',
    'Fleet tracking data gap',
    'Warehouse management sync error',
    'Delivery ETA miscalculation',
    'Inventory level discrepancy',
    'Driver app integration failure',
    'Freight cost report wrong',
    'Supply chain visibility issue',
  ],
  Healthcare: [
    'Patient data access slow',
    'HIPAA compliance report error',
    'EHR integration timeout',
    'Clinical dashboard not loading',
    'Billing code mismatch',
    'Appointment analytics broken',
    'Lab results feed failure',
    'Provider credential data issue',
  ],
  Fintech: [
    'Payment feed intermittently fails',
    'Transaction report delay',
    'Risk scoring not updating',
    'Compliance alert false positive',
    'Account balance discrepancy',
    'Settlement report error',
    'Fraud detection feed down',
    'API rate limit exceeded',
  ],
  Software: [
    'Billing sync blocked',
    'Deployment pipeline failure',
    'Customer usage metrics stale',
    'API documentation outdated',
    'SaaS metric dashboard error',
    'User authentication timeout',
    'Webhook delivery failure',
    'Integration test environment down',
  ],
  Banking: [
    'Regulatory report generation failed',
    'Transaction monitoring alert',
    'Customer statement delay',
    'Branch performance data stale',
    'Loan portfolio analytics error',
    'Audit trail export broken',
    'Interest rate calculation off',
    'Anti-money laundering feed down',
  ],
  Manufacturing: [
    'Production line analytics down',
    'Quality control data gap',
    'Supply chain dashboard error',
    'Inventory turnover miscalculation',
    'Equipment efficiency report stale',
    'Procurement analytics timeout',
    'Plant floor data integration issue',
    'Vendor scorecard not updating',
  ],
  Energy: [
    'Grid consumption data delay',
    'Renewable output report error',
    'Carbon emissions calculation off',
    'Energy trading analytics broken',
    'Asset performance dashboard down',
    'Weather integration feed failure',
    'Regulatory compliance report error',
    'Smart meter data pipeline issue',
  ],
  Insurance: [
    'Claims processing analytics slow',
    'Underwriting model not scoring',
    'Policy renewal report error',
    'Agent performance dashboard down',
    'Premium calculation discrepancy',
    'Risk pool data stale',
    'Reinsurance report timeout',
    'Customer lifetime value broken',
  ],
  Education: [
    'Student performance dashboard error',
    'Enrollment analytics timeout',
    'Curriculum tracking data issue',
    'Assessment results not loading',
    'Faculty workload report broken',
    'Accreditation data export failed',
    'Learning management sync error',
    'Graduation rate miscalculation',
  ],
  'Professional Services': [
    'Project profitability report off',
    'Resource allocation dashboard error',
    'Time entry analytics broken',
    'Client billing discrepancy',
    'Utilization rate calculation wrong',
    'Pipeline forecast not updating',
    'Engagement margin report stale',
    'Skills inventory data issue',
  ],
  Media: [
    'Content performance dashboard slow',
    'Ad revenue analytics mismatch',
    'Audience metric data gap',
    'Publisher report generation failed',
    'Campaign ROI calculation off',
    'Social media analytics feed down',
    'Subscription churn data stale',
    'Content recommendation broken',
  ],
};

type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

function getPriorityDistribution(healthScore: number): TicketPriority[] {
  if (healthScore >= 80) {
    return ['LOW', 'LOW', 'LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'LOW'];
  }
  if (healthScore >= 60) {
    return ['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'LOW', 'MEDIUM', 'HIGH'];
  }
  if (healthScore >= 40) {
    return [
      'MEDIUM',
      'MEDIUM',
      'HIGH',
      'HIGH',
      'HIGH',
      'CRITICAL',
      'CRITICAL',
      'MEDIUM',
      'HIGH',
      'CRITICAL',
    ];
  }
  return [
    'HIGH',
    'HIGH',
    'CRITICAL',
    'CRITICAL',
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'CRITICAL',
    'HIGH',
    'CRITICAL',
  ];
}

function getTicketCount(healthScore: number): number {
  if (healthScore >= 80) return 1;
  if (healthScore >= 60) return 2;
  if (healthScore >= 40) return 3;
  return 4;
}

function resolveTicket(
  priority: TicketPriority,
  openedAt: Date,
  healthScore: number,
): { status: TicketStatus; resolvedAt: Date | null; slaBreached: boolean } {
  const resolutionHours: Record<TicketPriority, number> = {
    LOW: 12,
    MEDIUM: 36,
    HIGH: 24,
    CRITICAL: 6,
  };

  const breachPercent: Record<TicketPriority, number> = {
    LOW: 5,
    MEDIUM: 10,
    HIGH: 25,
    CRITICAL: 40,
  };

  const slaThreshold = healthScore >= 80 ? 0.5 : healthScore >= 60 ? 1 : healthScore >= 40 ? 2 : 3;
  const slaSeed = `${openedAt.toISOString()}-${priority}-sla`;
  const slaBreached = hashInt(slaSeed) % 100 < breachPercent[priority] * slaThreshold;

  const hoursToResolve = resolutionHours[priority] * (slaBreached ? 1.5 : 1);

  const statusSeed = `${openedAt.toISOString()}-${priority}-status`;
  if (hashInt(statusSeed) % 100 < 15) {
    return { status: 'OPEN', resolvedAt: null, slaBreached };
  }
  const progressSeed = `${openedAt.toISOString()}-${priority}-progress`;
  if (hashInt(progressSeed) % 100 < 25) {
    return { status: 'IN_PROGRESS', resolvedAt: null, slaBreached };
  }
  const resolvedSeed = `${openedAt.toISOString()}-${priority}-resolved`;
  if (hashInt(resolvedSeed) % 100 < 40) {
    return {
      status: 'RESOLVED',
      resolvedAt: addHours(openedAt, Math.round(hoursToResolve)),
      slaBreached,
    };
  }
  return {
    status: 'CLOSED',
    resolvedAt: addHours(openedAt, Math.round(hoursToResolve * 1.2)),
    slaBreached,
  };
}

export async function seedSupportTickets(
  prisma: PrismaClient,
  customerByExternalId: Map<string, string>,
  healthScores: Map<string, number>,
): Promise<void> {
  let ticketCounter = 0;

  for (let monthIdx = 0; monthIdx < MONTH_COUNT; monthIdx++) {
    const monthStart = monthFromIndex(monthIdx);

    for (const customer of customers) {
      const healthScore = healthScores.get(customer.externalId) ?? 50;
      const ticketCount = getTicketCount(healthScore);

      const subjects = ticketSubjects[customer.industry] ?? ticketSubjects.Software;
      const priorityPool = getPriorityDistribution(healthScore);

      for (let t = 0; t < ticketCount; t++) {
        ticketCounter++;
        const seed = `${customer.externalId}-${String(monthIdx)}-${String(t)}`;

        const priority = deterministicChoice(seed + '-prio', priorityPool);
        const subject = deterministicChoice(seed + '-subj', subjects);

        const dayOffset = hashInt(seed + '-day') % 28;
        const hourOffset = hashInt(seed + '-hour') % 12;
        const openedAt = addHours(addHours(monthStart, dayOffset * 24), hourOffset);

        const { status, resolvedAt, slaBreached } = resolveTicket(priority, openedAt, healthScore);

        const externalId = `ticket-${customer.externalId}-${String(ticketCounter).padStart(3, '0')}`;

        await prisma.supportTicket.upsert({
          where: { externalId },
          update: {
            customerId: requireId(customerByExternalId, customer.externalId),
            openedAt,
            resolvedAt,
            priority,
            status,
            slaBreached,
            subject,
          },
          create: {
            externalId,
            customerId: requireId(customerByExternalId, customer.externalId),
            openedAt,
            resolvedAt,
            priority,
            status,
            slaBreached,
            subject,
          },
        });
      }
    }
  }
}
