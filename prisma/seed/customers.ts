export type CustomerDef = {
  externalId: string;
  name: string;
  segment: string;
  industry: string;
  healthScore: number;
  riskLevel: string;
};

export const customers: readonly CustomerDef[] = [
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
  {
    externalId: 'cust-meridian',
    name: 'Meridian Bank',
    segment: 'Enterprise',
    industry: 'Banking',
    healthScore: 92,
    riskLevel: 'low',
  },
  {
    externalId: 'cust-apex',
    name: 'Apex Manufacturing',
    segment: 'Mid Market',
    industry: 'Manufacturing',
    healthScore: 76,
    riskLevel: 'low',
  },
  {
    externalId: 'cust-solara',
    name: 'Solara Energy',
    segment: 'Enterprise',
    industry: 'Energy',
    healthScore: 82,
    riskLevel: 'low',
  },
  {
    externalId: 'cust-dovetail',
    name: 'Dovetail Insurance',
    segment: 'Enterprise',
    industry: 'Insurance',
    healthScore: 78,
    riskLevel: 'low',
  },
  {
    externalId: 'cust-prism',
    name: 'Prism Education',
    segment: 'SMB',
    industry: 'Education',
    healthScore: 65,
    riskLevel: 'medium',
  },
  {
    externalId: 'cust-riverbend',
    name: 'Riverbend Consulting',
    segment: 'Mid Market',
    industry: 'Professional Services',
    healthScore: 58,
    riskLevel: 'medium',
  },
  {
    externalId: 'cust-vantage',
    name: 'Vantage Media',
    segment: 'Mid Market',
    industry: 'Media',
    healthScore: 48,
    riskLevel: 'high',
  },
  {
    externalId: 'cust-northline',
    name: 'Northline Healthcare',
    segment: 'Mid Market',
    industry: 'Healthcare',
    healthScore: 80,
    riskLevel: 'low',
  },
] as const;
