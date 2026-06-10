import { PrismaClient } from '@prisma/client';
import { requireId } from './helpers.js';

type ProjectRow = {
  externalId: string;
  customerExternalId: string;
  name: string;
  status: 'PLANNED' | 'ACTIVE' | 'AT_RISK' | 'COMPLETED' | 'CANCELED';
  budget: string;
  estimatedCost: string;
  startDate: string;
  targetEndDate: string;
};

const projects: ProjectRow[] = [
  {
    externalId: 'proj-atlas-dw',
    customerExternalId: 'cust-atlas',
    name: 'Data Warehouse Modernization',
    status: 'COMPLETED',
    budget: '95000.00',
    estimatedCost: '88000.00',
    startDate: '2024-03-01',
    targetEndDate: '2024-09-30',
  },
  {
    externalId: 'proj-atlas-platform',
    customerExternalId: 'cust-atlas',
    name: 'Executive Analytics Platform',
    status: 'ACTIVE',
    budget: '125000.00',
    estimatedCost: '82000.00',
    startDate: '2026-02-01',
    targetEndDate: '2026-09-30',
  },
  {
    externalId: 'proj-nova-integration',
    customerExternalId: 'cust-nova',
    name: 'Logistics Integration',
    status: 'AT_RISK',
    budget: '78000.00',
    estimatedCost: '72000.00',
    startDate: '2026-01-15',
    targetEndDate: '2026-07-31',
  },
  {
    externalId: 'proj-nova-route',
    customerExternalId: 'cust-nova',
    name: 'Route Optimization Engine',
    status: 'COMPLETED',
    budget: '45000.00',
    estimatedCost: '42000.00',
    startDate: '2024-06-01',
    targetEndDate: '2025-01-31',
  },
  {
    externalId: 'proj-pulse-ehr',
    customerExternalId: 'cust-pulse',
    name: 'EHR Integration Hub',
    status: 'COMPLETED',
    budget: '78000.00',
    estimatedCost: '74000.00',
    startDate: '2024-10-01',
    targetEndDate: '2025-04-30',
  },
  {
    externalId: 'proj-pulse-modernization',
    customerExternalId: 'cust-pulse',
    name: 'Data Modernization',
    status: 'ACTIVE',
    budget: '94000.00',
    estimatedCost: '64000.00',
    startDate: '2026-03-01',
    targetEndDate: '2026-10-15',
  },
  {
    externalId: 'proj-zenith-core',
    customerExternalId: 'cust-zenith',
    name: 'Core Banking Analytics',
    status: 'COMPLETED',
    budget: '120000.00',
    estimatedCost: '108000.00',
    startDate: '2024-05-01',
    targetEndDate: '2024-12-31',
  },
  {
    externalId: 'proj-zenith-remediation',
    customerExternalId: 'cust-zenith',
    name: 'Finance Risk Remediation',
    status: 'AT_RISK',
    budget: '68000.00',
    estimatedCost: '66000.00',
    startDate: '2026-02-10',
    targetEndDate: '2026-07-20',
  },
  {
    externalId: 'proj-cobalt-scale',
    customerExternalId: 'cust-cobalt',
    name: 'Scaling Infrastructure',
    status: 'COMPLETED',
    budget: '38000.00',
    estimatedCost: '35000.00',
    startDate: '2024-07-01',
    targetEndDate: '2024-12-15',
  },
  {
    externalId: 'proj-cobalt-devops',
    customerExternalId: 'cust-cobalt',
    name: 'DevOps Automation',
    status: 'COMPLETED',
    budget: '28000.00',
    estimatedCost: '26000.00',
    startDate: '2025-02-01',
    targetEndDate: '2025-06-30',
  },
  {
    externalId: 'proj-cobalt-ai',
    customerExternalId: 'cust-cobalt',
    name: 'AI-Powered Recommendations',
    status: 'COMPLETED',
    budget: '52000.00',
    estimatedCost: '48000.00',
    startDate: '2025-11-01',
    targetEndDate: '2026-04-30',
  },
  {
    externalId: 'proj-cobalt-scalability',
    customerExternalId: 'cust-cobalt',
    name: 'Scalability Upgrade',
    status: 'ACTIVE',
    budget: '45000.00',
    estimatedCost: '28000.00',
    startDate: '2026-05-01',
    targetEndDate: '2026-11-30',
  },
  {
    externalId: 'proj-meridian-core',
    customerExternalId: 'cust-meridian',
    name: 'Executive Risk Dashboard',
    status: 'COMPLETED',
    budget: '145000.00',
    estimatedCost: '132000.00',
    startDate: '2024-04-01',
    targetEndDate: '2025-02-28',
  },
  {
    externalId: 'proj-apex-erp',
    customerExternalId: 'cust-apex',
    name: 'ERP Integration',
    status: 'ACTIVE',
    budget: '35000.00',
    estimatedCost: '22000.00',
    startDate: '2026-06-01',
    targetEndDate: '2026-12-31',
  },
  {
    externalId: 'proj-solara-grid',
    customerExternalId: 'cust-solara',
    name: 'Grid Analytics Platform',
    status: 'COMPLETED',
    budget: '68000.00',
    estimatedCost: '63000.00',
    startDate: '2025-01-01',
    targetEndDate: '2025-08-31',
  },
  {
    externalId: 'proj-solara-infra',
    customerExternalId: 'cust-solara',
    name: 'Infrastructure Setup',
    status: 'COMPLETED',
    budget: '42000.00',
    estimatedCost: '38000.00',
    startDate: '2024-08-01',
    targetEndDate: '2024-12-31',
  },
  {
    externalId: 'proj-vantage-digital',
    customerExternalId: 'cust-vantage',
    name: 'Digital Transformation',
    status: 'CANCELED',
    budget: '54000.00',
    estimatedCost: '12000.00',
    startDate: '2025-06-01',
    targetEndDate: '2025-09-30',
  },
  {
    externalId: 'proj-northline-pipeline',
    customerExternalId: 'cust-northline',
    name: 'Patient Data Pipeline',
    status: 'COMPLETED',
    budget: '48000.00',
    estimatedCost: '44000.00',
    startDate: '2025-06-01',
    targetEndDate: '2025-12-31',
  },
  {
    externalId: 'proj-northline-hipaa',
    customerExternalId: 'cust-northline',
    name: 'HIPAA Compliance Module',
    status: 'PLANNED',
    budget: '28000.00',
    estimatedCost: '18000.00',
    startDate: '2026-08-01',
    targetEndDate: '2027-01-31',
  },
];

export async function seedProjects(
  prisma: PrismaClient,
  customerByExternalId: Map<string, string>,
): Promise<Map<string, string>> {
  const projectByExternalId = new Map<string, string>();

  for (const project of projects) {
    const customerId = requireId(customerByExternalId, project.customerExternalId);

    const saved = await prisma.project.upsert({
      where: { externalId: project.externalId },
      update: {
        customerId,
        name: project.name,
        status: project.status,
        budget: project.budget,
        estimatedCost: project.estimatedCost,
        startDate: new Date(project.startDate),
        targetEndDate: new Date(project.targetEndDate),
      },
      create: {
        externalId: project.externalId,
        customerId,
        name: project.name,
        status: project.status,
        budget: project.budget,
        estimatedCost: project.estimatedCost,
        startDate: new Date(project.startDate),
        targetEndDate: new Date(project.targetEndDate),
      },
    });

    projectByExternalId.set(project.externalId, saved.id);
  }

  return projectByExternalId;
}
