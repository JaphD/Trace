import { uid, type Workspace, type Project, type BomRow, type Observation } from './types';
import { defaultBuild, defaultPricing } from './calculations';
import { validateRows } from './bom';
export const STORAGE_KEY = 'jlcpcb-workbench-v2';
export const emptyWorkspace = (): Workspace => ({
  version: 2,
  projects: [],
  observations: {},
  inventory: [],
  pricing: defaultPricing(),
  events: [],
  settings: { pollMinutes: 5, pollEnabled: false, staleMinutes: 30 },
});
// Preserve historical runs; only the live editor adopts today's minimum.
export function editableWorkspace(w: Workspace): Workspace {
  return {
    ...w,
    projects: w.projects.map((p) =>
      p.workingBuild.quantity < 2
        ? {
            ...p,
            workingBuild: { ...p.workingBuild, quantity: 2, boardReviewed: false },
          }
        : p,
    ),
  };
}
export function removeProject(w: Workspace, id: string): Workspace {
  const project = w.projects.find((p) => p.id === id);
  if (!project) return w;
  const builds = new Set([project.workingBuild.id, ...project.builds.map((b) => b.id)]);
  return {
    ...w,
    projects: w.projects.filter((p) => p.id !== id),
    inventory: w.inventory.map((lot) => ({
      ...lot,
      allocations: lot.allocations.filter((a) => !builds.has(a.buildId)),
    })),
  };
}
const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const object = (x: any) => x && typeof x === 'object' && !Array.isArray(x);
const fail = (message: string): never => {
  throw new Error('Invalid backup: ' + message);
};
function checkBuild(b: any) {
  if (b?.costScope !== undefined && !['full', 'selected'].includes(b.costScope)) fail('cost scope');
  if (
    b?.excludedCodes !== undefined &&
    (!Array.isArray(b.excludedCodes) ||
      !b.excludedCodes.every((c) => typeof c === 'string' && /^C\d+$/.test(c)))
  )
    fail('quote selections');
  if (b?.loadingOverride != null && !finite(b.loadingOverride)) fail('loading override');
  if (
    !object(b) ||
    typeof b.id !== 'string' ||
    typeof b.name !== 'string' ||
    !['scenario', 'planned', 'ordered', 'completed', 'cancelled'].includes(b.status)
  )
    fail('build');
  if (
    !Number.isInteger(b.quantity) ||
    b.quantity < 1 ||
    !Number.isInteger(b.boardsPerPanel) ||
    b.boardsPerPanel < 1
  )
    fail('build quantity');
  if (
    !['board', 'panel'].includes(b.bomBasis) ||
    !['economic', 'standard'].includes(b.mode) ||
    !['single', 'double'].includes(b.sides) ||
    !['public', 'private'].includes(b.source) ||
    !object(b.extras) ||
    !object(b.attrition)
  )
    fail('build options');
  for (const key of ['fabrication', 'assembly', 'shipping', 'tax', 'other'])
    if (b.extras[key] !== null && !finite(b.extras[key])) fail('cost');
  if (b.quoteOverride !== null && !finite(b.quoteOverride)) fail('quote');
  if (b.assemblyFees !== undefined) {
    if (!object(b.assemblyFees)) fail('assembly fees');
    for (const key of [
      'xrayOverride',
      'specialOverride',
      'packagingOverride',
      'smtOverride',
      'smtJointsPerBom',
    ]) {
      const value = b.assemblyFees[key];
      if (
        value != null &&
        (!finite(value) || (key === 'smtJointsPerBom' && !Number.isSafeInteger(value)))
      )
        fail('assembly fees');
    }
  }
  for (const a of Object.values(b.attrition) as any[])
    if (!object(a) || !['extra', 'percent', 'minimum', 'spares'].every((k) => finite(a[k])))
      fail('attrition');
}
function checkRows(rows: any) {
  if (!Array.isArray(rows)) fail('BOM rows');
  const ids = new Set();
  for (const r of rows) {
    if (
      !object(r) ||
      typeof r.id !== 'string' ||
      ids.has(r.id) ||
      typeof r.code !== 'string' ||
      !Array.isArray(r.refs) ||
      !r.refs.every((x) => typeof x === 'string') ||
      !Array.isArray(r.tags) ||
      !r.tags.every((x) => typeof x === 'string') ||
      !Array.isArray(r.issues) ||
      !Array.isArray(r.alternatives)
    )
      fail('BOM row fields');
    ids.add(r.id);
    if (r.description !== undefined && typeof r.description !== 'string') fail('BOM description');
    if (r.identityReview !== undefined && typeof r.identityReview !== 'string')
      fail('BOM identity review');
    if (
      r.assembly !== undefined &&
      (!object(r.assembly) ||
        (r.assembly.xray !== undefined &&
          !['auto', 'required', 'not-required'].includes(r.assembly.xray)) ||
        (r.assembly.specialFee != null && !finite(r.assembly.specialFee)))
    )
      fail('component assembly fees');
    if (
      !['jlc', 'dnp', 'manual'].includes(r.population) ||
      !['value', 'footprint', 'mpn', 'notes'].every((k) => typeof r[k] === 'string')
    )
      fail('BOM row values');
    if (r.qty !== null && (!finite(r.qty) || !Number.isInteger(r.qty))) fail('BOM quantity');
    for (const a of r.alternatives)
      if (
        typeof a.code !== 'string' ||
        !['candidate', 'footprint', 'approved', 'tested'].includes(a.status) ||
        typeof a.notes !== 'string'
      )
        fail('alternative');
  }
}
function checkObservations(observations: any) {
  if (!object(observations)) fail('observations');
  for (const [code, o] of Object.entries(observations) as [string, any][]) {
    if (o?.supplierRules !== undefined) {
      const r = o.supplierRules;
      if (
        !object(r) ||
        !['smt', 'tht', 'unknown'].includes(r.process) ||
        (r.pcbaType !== undefined && r.pcbaType !== null && ![0, 1, 2].includes(r.pcbaType)) ||
        !['minimum', 'extra'].every(
          (k) => r[k] === null || (finite(r[k]) && Number.isSafeInteger(r[k])),
        )
      )
        fail('supplier rules');
    }
    if (
      o?.assembly !== undefined &&
      (!object(o.assembly) ||
        (o.assembly.xrayFlag !== null && typeof o.assembly.xrayFlag !== 'boolean') ||
        (o.assembly.specialFee !== null && !finite(o.assembly.specialFee)))
    )
      fail('supplier assembly metadata');
    if (
      !/^C\d+$/.test(code) ||
      !object(o) ||
      o.code !== code ||
      (o.stock !== null && !finite(o.stock)) ||
      !Array.isArray(o.prices) ||
      !Array.isArray(o.history) ||
      !finite(o.updatedAt)
    )
      fail('supplier observation');
    if (
      !['basic', 'preferred', 'extended', 'unknown'].includes(o.library) ||
      !['economic', 'standard', 'unknown'].includes(o.eligibility)
    )
      fail('supplier classification');
    for (const p of o.prices)
      if (!finite(p.startNumber) || p.startNumber < 1 || !finite(p.productPrice))
        fail('price tiers');
    if (
      !['model', 'brand', 'description', 'footprint', 'category'].every(
        (k) => typeof o[k] === 'string',
      )
    )
      fail('observation metadata');
    for (const h of o.history)
      if (
        !object(h) ||
        !finite(h.date) ||
        (h.stock !== null && !finite(h.stock)) ||
        (h.price !== null && !finite(h.price)) ||
        !finite(h.basis) ||
        h.currency !== 'USD'
      )
        fail('history');
  }
}
function checkPricing(pricing: any) {
  if (pricing?.assembly !== undefined) {
    const rates = pricing.assembly;
    if (
      !object(rates) ||
      !['standardPackaging', 'economicPackaging', 'smtPerJoint'].every((k) => finite(rates[k])) ||
      !Array.isArray(rates.xrayTiers) ||
      !rates.xrayTiers.length ||
      rates.xrayTiers[0]?.startNumber !== 1
    )
      fail('assembly pricing');
    let previous = 0;
    for (const tier of rates.xrayTiers) {
      if (
        !object(tier) ||
        !Number.isSafeInteger(tier.startNumber) ||
        tier.startNumber <= previous ||
        !finite(tier.productPrice)
      )
        fail('assembly pricing tiers');
      previous = tier.startNumber;
    }
  }
  if (
    !object(pricing) ||
    ![
      'economicExtended',
      'standardFeeder',
      'economicSetup',
      'standardSetup',
      'economicStencil',
      'standardStencil',
    ].every((k) => finite(pricing[k])) ||
    typeof pricing.date !== 'string' ||
    typeof pricing.note !== 'string' ||
    typeof pricing.preferredFree !== 'boolean' ||
    typeof pricing.verified !== 'boolean'
  )
    fail('pricing');
}
export function validateWorkspace(raw: any): Workspace {
  if (
    !object(raw) ||
    raw.version !== 2 ||
    !Array.isArray(raw.projects) ||
    !Array.isArray(raw.inventory) ||
    !Array.isArray(raw.events)
  )
    fail('unsupported format/version');
  if (
    !object(raw.settings) ||
    !finite(raw.settings.pollMinutes) ||
    raw.settings.pollMinutes < 1 ||
    !finite(raw.settings.staleMinutes) ||
    raw.settings.staleMinutes < 1 ||
    typeof raw.settings.pollEnabled !== 'boolean'
  )
    fail('settings');
  checkPricing(raw.pricing);
  for (const e of raw.events)
    if (
      !object(e) ||
      typeof e.id !== 'string' ||
      typeof e.message !== 'string' ||
      typeof e.kind !== 'string' ||
      !finite(e.date)
    )
      fail('event');
  checkObservations(raw.observations);
  const pids = new Set<string>(),
    buildIds = new Set<string>();
  for (const p of raw.projects) {
    if (
      !object(p) ||
      typeof p.id !== 'string' ||
      pids.has(p.id) ||
      typeof p.name !== 'string' ||
      typeof p.description !== 'string' ||
      !Array.isArray(p.revisions) ||
      !Array.isArray(p.builds)
    )
      fail('project');
    pids.add(p.id);
    checkRows(p.rows);
    checkBuild(p.workingBuild);
    const revisionIds = new Set();
    for (const r of p.revisions) {
      if (
        !object(r) ||
        typeof r.id !== 'string' ||
        typeof r.name !== 'string' ||
        revisionIds.has(r.id) ||
        !finite(r.date)
      )
        fail('revision');
      revisionIds.add(r.id);
      checkRows(r.rows);
      checkBuild(r.build);
      checkObservations(r.observations);
      checkPricing(r.pricing);
      if (r.inventory !== undefined && !Array.isArray(r.inventory)) fail('snapshot inventory');
    }
    for (const b of [p.workingBuild, ...p.builds]) {
      checkBuild(b);
      if (buildIds.has(b.id)) fail('duplicate build ID');
      buildIds.add(b.id);
      if (b.revisionId && !p.revisions.some((r) => r.id === b.revisionId))
        fail('missing pinned revision');
    }
  }
  const lotIds = new Set<string>();
  for (const l of raw.inventory) {
    if (
      !object(l) ||
      typeof l.id !== 'string' ||
      lotIds.has(l.id) ||
      !/^C\d+$/.test(l.code) ||
      !finite(l.quantity) ||
      !Number.isInteger(l.quantity) ||
      !['private', 'consigned', 'bench'].includes(l.source) ||
      !['received', 'incoming'].includes(l.status) ||
      !Array.isArray(l.allocations)
    )
      fail('inventory lot');
    lotIds.add(l.id);
    let sum = 0;
    const used = new Set();
    for (const a of l.allocations) {
      if (
        !buildIds.has(a.buildId) ||
        used.has(a.buildId) ||
        !finite(a.quantity) ||
        !Number.isInteger(a.quantity)
      )
        fail('inventory allocation');
      used.add(a.buildId);
      sum += a.quantity;
    }
    if (l.unitCost !== null && !finite(l.unitCost)) fail('inventory cost');
    if (sum > l.quantity || (sum > 0 && (l.status === 'incoming' || l.source === 'bench')))
      fail('overallocated/unavailable stock');
  }
  return structuredClone(raw);
}
export function migrate(raw: any): Workspace {
  if (raw?.version !== undefined) return validateWorkspace(raw);
  if (!Array.isArray(raw)) fail('expected a workspace or legacy project array');
  const w = emptyWorkspace();
  w.projects = raw.map((p) => {
    if (!object(p) || typeof p.name !== 'string' || !Array.isArray(p.parts)) fail('legacy project');
    const rows: BomRow[] = p.parts.map((part: any) => {
      if (!object(part) || typeof part.componentCode !== 'string') fail('legacy component');
      const code = part.componentCode.trim().toUpperCase();
      const row: BomRow = {
        id: uid(),
        code,
        refs: [],
        qty: part.requiredQty ?? null,
        value: part.describe || '',
        footprint: part.footprint || '',
        mpn: part.componentModelEn || '',
        population: 'jlc',
        tags: part.tags || [],
        notes: '',
        alternatives: (part.alternatives || []).map((code) => ({
          code,
          status: 'candidate',
          notes: 'Imported; not validated',
          date: Date.now(),
        })),
        issues: [],
        minStock: part.minStockLevel,
      };
      if (/^C\d+$/.test(code)) {
        const o: Observation = {
          code,
          model: part.componentModelEn || '',
          brand: part.componentBrandEn || '',
          description: part.describe || '',
          footprint: part.footprint || '',
          category: part.componentType || '',
          stock: finite(part.stockCount) ? part.stockCount : null,
          prices: part.prices || [],
          library:
            part.componentLibraryType === 'base'
              ? 'basic'
              : part.componentLibraryType === 'expand'
                ? 'extended'
                : 'unknown',
          rawLibrary: part.componentLibraryType,
          eligibility: 'unknown',
          updatedAt: part.lastUpdated || 0,
          history: [],
          legacyPriceHistory: part.priceHistory,
        };
        if (!w.observations[code] || o.updatedAt > w.observations[code].updatedAt)
          w.observations[code] = o;
      }
      return row;
    });
    return {
      id: p.id || uid(),
      name: p.name,
      description: p.description || '',
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || Date.now(),
      rows: validateRows(rows),
      workingBuild: { ...defaultBuild(), quantity: Math.max(1, Math.floor(p.batchSize || 1)) },
      revisions: [],
      builds: [],
    } as Project;
  });
  return validateWorkspace(w);
}
export function mergeWorkspace(current: Workspace, incoming: Workspace): Workspace {
  const copy = structuredClone(incoming),
    buildMap = new Map<string, string>();
  for (const p of copy.projects) {
    p.id = uid();
    p.name += ' (imported)';
    const revMap = new Map(p.revisions.map((r) => [r.id, uid()]));
    for (const r of p.revisions) r.id = revMap.get(r.id)!;
    for (const b of [p.workingBuild, ...p.builds]) {
      const id = uid();
      buildMap.set(b.id, id);
      b.id = id;
      if (b.revisionId) b.revisionId = revMap.get(b.revisionId);
    }
  }
  for (const p of copy.projects) {
    for (const b of [p.workingBuild, ...p.builds]) {
      if (b.basedOnBuildId) b.basedOnBuildId = buildMap.get(b.basedOnBuildId);
    }
  }
  const existingLots = new Set(current.inventory.map((l) => l.id));
  copy.inventory = copy.inventory.filter((l) => !existingLots.has(l.id));
  for (const l of copy.inventory) {
    l.allocations = l.allocations.map((a) => ({ ...a, buildId: buildMap.get(a.buildId)! }));
  }
  const observations = { ...current.observations };
  for (const [c, o] of Object.entries(copy.observations))
    if (!observations[c] || o.updatedAt > observations[c].updatedAt) observations[c] = o;
  return validateWorkspace({
    ...current,
    projects: [...current.projects, ...copy.projects],
    inventory: [...current.inventory, ...copy.inventory],
    observations,
  });
}
