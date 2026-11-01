export type Library = 'basic' | 'preferred' | 'extended' | 'unknown';
export type AssemblyEligibility = 'economic' | 'standard' | 'unknown';
export interface Alternative {
  code: string;
  status: 'candidate' | 'footprint' | 'approved' | 'tested';
  notes: string;
  date: number;
}
export interface BomRow {
  id: string;
  code: string;
  refs: string[];
  qty: number | null;
  value: string;
  description?: string;
  footprint: string;
  mpn: string;
  population: 'jlc' | 'dnp' | 'manual';
  tags: string[];
  notes: string;
  alternatives: Alternative[];
  issues: string[];
  sourceRow?: number;
  source?: Record<string, string>;
  minStock?: number;
  critical?: boolean;
  populationExplicit?: boolean;
  identityReview?: string;
  assembly?: { xray?: 'auto' | 'required' | 'not-required'; specialFee?: number | null };
}
export interface Observation {
  code: string;
  model: string;
  brand: string;
  description: string;
  footprint: string;
  category: string;
  stock: number | null;
  prices: { startNumber: number; productPrice: number }[];
  library: Library;
  rawLibrary?: string;
  eligibility: AssemblyEligibility;
  updatedAt: number;
  attemptedAt?: number;
  error?: string;
  manual?: boolean;
  history: {
    date: number;
    stock: number | null;
    price: number | null;
    basis: number;
    currency: 'USD';
    library: Library;
    eligibility: AssemblyEligibility;
  }[];
  legacyPriceHistory?: unknown;
  manualUpdatedAt?: number;
  manualFields?: string[];
  assembly?: { xrayFlag: boolean | null; specialFee: number | null };
  supplierRules?: {
    minimum: number | null;
    extra: number | null;
    process: 'smt' | 'tht' | 'unknown';
    pcbaType?: number | null;
  };
}
export interface Attrition {
  extra: number;
  percent: number;
  minimum: number;
  spares: number;
  verified: boolean;
}
export interface Build {
  id: string;
  name: string;
  status: 'scenario' | 'planned' | 'ordered' | 'completed' | 'cancelled';
  revisionId?: string;
  targetDate?: string;
  basedOnBuildId?: string;
  quantity: number;
  boardsPerPanel: number;
  bomBasis: 'board' | 'panel';
  mode: 'economic' | 'standard';
  bareBoards?: number | null;
  sides: 'single' | 'double';
  layers: number | null;
  width: number | null;
  height: number | null;
  thickness: number | null;
  panelMethod: 'single' | 'mouse-bites' | 'v-cut';
  boardReviewed: boolean;
  attrition: Record<string, Attrition>;
  source: 'public' | 'private';
  costScope?: 'full' | 'selected';
  excludedCodes?: string[];
  loadingOverride?: number | null;
  extras: {
    fabrication: number | null;
    assembly: number | null;
    shipping: number | null;
    tax: number | null;
    other: number | null;
  };
  quoteOverride: number | null;
  quoteNote: string;
  assemblyFees?: {
    xrayOverride?: number | null;
    specialOverride?: number | null;
    packagingOverride?: number | null;
    smtOverride?: number | null;
    smtJointsPerBom?: number | null;
  };
}
export interface AssemblyPricing {
  xrayTiers: { startNumber: number; productPrice: number }[];
  standardPackaging: number;
  economicPackaging: number;
  smtPerJoint: number;
}
export interface Pricing {
  date: string;
  source: string;
  note: string;
  economicExtended: number;
  standardFeeder: number;
  economicSetup: number;
  standardSetup: number;
  economicStencil: number;
  standardStencil: number;
  preferredFree: boolean;
  verified: boolean;
  assembly?: AssemblyPricing;
}
export interface Revision {
  id: string;
  name: string;
  date: number;
  rows: BomRow[];
  observations: Record<string, Observation>;
  build: Build;
  pricing: Pricing;
  inventory?: InventoryLot[];
}
export interface Project {
  id: string;
  name: string;
  description: string;
  rows: BomRow[];
  workingBuild: Build;
  revisions: Revision[];
  builds: Build[];
  createdAt: number;
  updatedAt: number;
}
export interface InventoryLot {
  id: string;
  code: string;
  quantity: number;
  source: 'private' | 'consigned' | 'bench';
  status: 'received' | 'incoming';
  date: number;
  notes: string;
  unitCost: number | null;
  allocations: { buildId: string; quantity: number }[];
}
export interface Activity {
  id: string;
  date: number;
  kind: string;
  message: string;
}
export interface Workspace {
  version: 2;
  projects: Project[];
  observations: Record<string, Observation>;
  inventory: InventoryLot[];
  pricing: Pricing;
  events: Activity[];
  settings: { pollMinutes: number; pollEnabled: boolean; staleMinutes: number };
}
export const uid = () => crypto.randomUUID();
