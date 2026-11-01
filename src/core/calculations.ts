import {
  uid,
  type Build,
  type Pricing,
  type BomRow,
  type Observation,
  type Project,
  type InventoryLot,
  type Attrition,
} from './types';
import { calculateAssemblyFees } from './assembly-fees';
import { quantityRequirement } from './quantities';
export const defaultBuild = (): Build => ({
  id: uid(),
  name: 'Working build',
  status: 'scenario',
  quantity: 2,
  boardsPerPanel: 1,
  bomBasis: 'board',
  mode: 'economic',
  sides: 'single',
  layers: null,
  width: null,
  height: null,
  thickness: null,
  panelMethod: 'single',
  boardReviewed: false,
  attrition: {},
  source: 'public',
  extras: { fabrication: null, assembly: null, shipping: null, tax: null, other: null },
  quoteOverride: null,
  quoteNote: '',
});
export const defaultPricing = (): Pricing => ({
  date: '2026-11-01',
  source: 'https://jlcpcb.com/help/article/pcb-assembly-price',
  note: 'Setup, stencil and loading reference rates from Standard and Economic assembly quotes, 1 Nov 2026. Existing profiles are preserved; rates can vary.',
  economicExtended: 3.09,
  standardFeeder: 1.55,
  economicSetup: 8.24,
  standardSetup: 25.75,
  economicStencil: 1.55,
  standardStencil: 8.27,
  preferredFree: true,
  verified: false,
});
export const positive = (v: number) => Math.max(1, Math.floor(Number(v) || 1));
export const priceFor = (prices: Observation['prices'], qty: number): number | null =>
  [...prices].filter((p) => p.startNumber <= qty).sort((a, b) => b.startNumber - a.startNumber)[0]
    ?.productPrice ?? null;
export const boardCount = (b: Build) => positive(b.quantity) * positive(b.boardsPerPanel);
export const multiplier = (b: Build) =>
  positive(b.quantity) * (b.bomBasis === 'board' ? positive(b.boardsPerPanel) : 1);
export const observationNeedsReview = (o: Observation | undefined, staleMinutes = 30) =>
  !o || !!o.error || !o.updatedAt || Date.now() - o.updatedAt > staleMinutes * 60000;
export const requirement = (placed: number, a?: Attrition) =>
  placed <= 0
    ? 0
    : Math.max(
        placed +
          Math.max(0, a?.extra || 0) +
          Math.ceil((placed * Math.max(0, a?.percent || 0)) / 100),
        Math.max(0, a?.minimum || 0),
      ) + Math.max(0, a?.spares || 0);
export function grouped(rows: BomRow[]) {
  const groups = new Map<string, { code: string; qty: number; refs: string[]; rows: BomRow[] }>();
  for (const r of rows.filter((x) => x.population === 'jlc')) {
    const key = r.code || 'unresolved:' + r.id;
    const group = groups.get(key) || { code: key, qty: 0, refs: [], rows: [] };
    group.qty += r.qty && r.qty > 0 ? r.qty : 0;
    group.refs.push(...r.refs);
    group.rows.push(r);
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function standardOnlyPackage(r: BomRow, o?: Observation) {
  return (
    (r.footprint + ' ' + (o?.footprint || '')).match(
      /(?:^|[^A-Z0-9])(?:R|C|L)?(0201|01005)(?:$|[^0-9])/i,
    )?.[1] || null
  );
}
export function eligibility(rows: BomRow[], observations: Record<string, Observation>, b: Build) {
  const reasons: string[] = [];
  let unknown = false;
  if (!rows.some((r) => r.population === 'jlc')) {
    unknown = true;
    reasons.push('No JLCPCB placements');
  }
  for (const r of rows.filter((r) => r.population === 'jlc')) {
    const o = observations[r.code];
    if (!o || o.eligibility === 'unknown') {
      unknown = true;
      reasons.push(
        (r.refs.join(', ') || r.code || 'Unresolved row') + ': assembly eligibility unknown',
      );
    }
    if (b.mode === 'economic' && o?.eligibility === 'standard')
      reasons.push((r.refs.join(', ') || r.code) + ': Standard-only component');
    if (b.mode === 'economic' && standardOnlyPackage(r, o))
      reasons.push((r.refs.join(', ') || r.code) + ': Standard-only 0201/01005 package');
  }
  const blocked = reasons.some((r) => r.includes('Standard-only'));
  let boardBlocked = false;
  if (b.mode === 'economic') {
    if (b.sides === 'double') {
      reasons.push('Double-sided assembly requires Standard');
      boardBlocked = true;
    }
    if (b.panelMethod === 'v-cut') {
      reasons.push('V-cut panel requires Standard');
      boardBlocked = true;
    }
    if (b.layers !== null && ![2, 4, 6].includes(b.layers)) {
      reasons.push('Layer count outside Economic reference range');
      boardBlocked = true;
    }
    if (b.thickness !== null && (b.thickness < 0.8 || b.thickness > 1.6)) {
      reasons.push('Thickness outside Economic reference range');
      boardBlocked = true;
    }
    if (b.quantity > 50) {
      reasons.push('Order quantity exceeds Economic reference range');
      boardBlocked = true;
    }
  }
  if (!b.width || !b.height || !b.layers || !b.thickness || !b.boardReviewed) {
    unknown = true;
    reasons.push('Board options need review against current JLCPCB capabilities');
  }
  if (b.quantity < 2) {
    unknown = true;
    reasons.push('One-unit calculation only; verify minimum order quantity');
  }
  if (rows.some((r) => r.population === 'jlc' && r.issues.length)) {
    unknown = true;
    reasons.push('Resolve BOM validation issues');
  }
  return {
    status: blocked || boardBlocked ? 'ineligible' : unknown ? 'incomplete' : 'checked',
    reasons,
  };
}
export function availablePrivate(lots: InventoryLot[], code: string, buildId: string) {
  return lots
    .filter((l) => l.code === code && l.status === 'received' && l.source !== 'bench')
    .reduce(
      (s, l) =>
        s + l.allocations.filter((a) => a.buildId === buildId).reduce((n, a) => n + a.quantity, 0),
      0,
    );
}
export function calculate(
  rows: BomRow[],
  observations: Record<string, Observation>,
  b: Build,
  pricing: Pricing,
  lots: InventoryLot[] = [],
  staleMinutes = 30,
) {
  const exclusions = new Set<string>();
  const lines = grouped(rows).map((g) => {
    const o = observations[g.code];
    const placed = g.qty * multiplier(b),
      quantity = quantityRequirement(placed, b, o, g.code),
      required = quantity.required;
    const stock =
      b.source === 'private' ? availablePrivate(lots, g.code, b.id) : (o?.stock ?? null);
    const unitPrice = priceFor(o?.prices || [], required);
    const fee =
      !placed || o?.supplierRules?.process === 'tht'
        ? 0
        : !o || o.library === 'unknown'
          ? null
          : b.mode === 'standard'
            ? pricing.standardFeeder
            : o.library === 'basic' || (o.library === 'preferred' && pricing.preferredFree)
              ? 0
              : pricing.economicExtended;
    if (unitPrice === null)
      exclusions.add('Unknown component prices / minimum purchase quantities');
    if (observationNeedsReview(o, staleMinutes))
      exclusions.add('Stale, failed or missing supplier observations; refresh before ordering');
    if (fee === null) exclusions.add('Unknown feeder classification');
    if (quantity.source === 'unknown' || quantity.source === 'private')
      exclusions.add('Supplier minimum/attrition unknown; placement-only or manual quantity used');
    else if (quantity.provisional)
      exclusions.add(
        'Minimum/attrition rules are estimates; verify quantities and side-specific allowances against the quote',
      );
    if (o?.supplierRules?.process === 'tht')
      exclusions.add('JLCPCB hand-soldering/manual assembly labor not automatically estimated');
    if (g.rows.some((r) => r.issues.length)) exclusions.add('BOM validation issues');
    let capacity: number | null = null;
    if (stock !== null && g.qty > 0) {
      let lo = 0,
        hi =
          Math.floor(stock / (g.qty * (b.bomBasis === 'board' ? positive(b.boardsPerPanel) : 1))) +
          1;
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (
          quantityRequirement(
            mid * g.qty * (b.bomBasis === 'board' ? positive(b.boardsPerPanel) : 1),
            b,
            o,
            g.code,
          ).required <= stock
        )
          lo = mid;
        else hi = mid;
      }
      capacity = lo * positive(b.boardsPerPanel);
    }
    const currentCost = unitPrice === null ? null : unitPrice * required;
    const suggestion = (o?.prices || [])
      .filter(
        (t) =>
          t.startNumber > required &&
          currentCost !== null &&
          t.startNumber * t.productPrice < currentCost,
      )
      .sort((x, y) => x.startNumber * x.productPrice - y.startNumber * y.productPrice)[0];
    return {
      ...g,
      placed,
      required,
      quantitySource: quantity.source,
      process: o?.supplierRules?.process || 'unknown',
      stock,
      unitPrice,
      fee,
      cost: currentCost,
      shortage: stock === null ? null : Math.max(0, required - stock),
      capacity,
      stale: observationNeedsReview(o, staleMinutes),
      provisional: quantity.provisional,
      remaining: stock === null ? null : stock - required,
      suggestion: suggestion
        ? {
            quantity: suggestion.startNumber,
            savings: currentCost! - suggestion.startNumber * suggestion.productPrice,
          }
        : null,
    };
  });
  const excluded = new Set(b.costScope === 'selected' ? b.excludedCodes || [] : []);
  const costLines = lines.filter((l) => !excluded.has(l.code));
  const componentCost = costLines.reduce((s, l) => s + (l.cost ?? 0), 0),
    estimatedFeederCost = costLines.reduce((s, l) => s + (l.fee ?? 0), 0),
    feederCost = b.loadingOverride ?? estimatedFeederCost;
  if (b.loadingOverride != null)
    exclusions.add(
      'Quoted loading amount is a fixed total; recheck after quantity, mode or quote-selection changes',
    );
  else if (
    b.mode === 'economic' &&
    costLines.some((l) => observations[l.code]?.library === 'extended')
  )
    exclusions.add(
      'Loading estimate may miss supplier Preferred/exemption flags; use the quoted loading amount when known',
    );
  let ownedValue = 0;
  let ownedValueComplete = true;
  if (b.source === 'private') {
    for (const line of costLines) {
      let remaining = line.required;
      for (const lot of [...lots]
        .filter((l) => l.code === line.code && l.status === 'received' && l.source !== 'bench')
        .sort((a, b) => a.date - b.date)) {
        const allocation = lot.allocations.find((a) => a.buildId === b.id)?.quantity || 0;
        const consumed = Math.min(remaining, allocation);
        if (consumed > 0 && lot.unitCost === null) ownedValueComplete = false;
        else ownedValue += consumed * (lot.unitCost || 0);
        remaining -= consumed;
      }
      if (remaining > 0) ownedValueComplete = false;
    }
  }
  const sides = b.sides === 'double' ? 2 : 1;
  const fixedCost = costLines.length
    ? b.mode === 'economic'
      ? pricing.economicSetup + pricing.economicStencil
      : (pricing.standardSetup + pricing.standardStencil) * sides
    : 0;
  const assemblyFees = calculateAssemblyFees(
    rows.filter((r) => !excluded.has(r.code)),
    observations,
    b,
    multiplier(b),
  );
  assemblyFees.assumptions.forEach((message) => exclusions.add(message));
  for (const [key, value] of Object.entries(b.extras).filter(([key]) => key !== 'fabrication'))
    if (value === null)
      exclusions.add(
        key === 'assembly'
          ? 'Other assembly fees not estimated (separate from the processing fees listed above)'
          : key + ' not included',
      );
  if (!pricing.verified) exclusions.add('Pricing profile not verified against current quote');
  if (b.source === 'private')
    exclusions.add(
      'Private source compatibility and any unallocated shortage purchases require review',
    );
  if (b.source === 'private' && !ownedValueComplete)
    exclusions.add('Owned component value incomplete: missing lot costs or allocations');
  if (eligibility(rows, observations, b).status === 'ineligible')
    exclusions.add(
      'Selected assembly service is incompatible; change configuration before relying on this estimate',
    );
  if (rows.some((r) => r.population === 'manual'))
    exclusions.add('Manual assembly parts and labor not included');
  const subtotal =
    (b.source === 'private' ? 0 : componentCost) +
    feederCost +
    fixedCost +
    assemblyFees.total +
    Object.entries(b.extras)
      .filter(([key]) => key !== 'fabrication')
      .reduce<number>((s, [, v]) => s + (v ?? 0), 0);
  const total = b.quoteOverride ?? subtotal;
  return {
    lines,
    costLines,
    componentCost,
    ownedValue: b.source === 'private' && ownedValueComplete ? ownedValue : null,
    feederCost,
    estimatedFeederCost,
    fixedCost,
    assemblyFees,
    total,
    perBoard: total / boardCount(b),
    exclusions: [...exclusions],
    capacity:
      !lines.length || lines.some((l) => l.capacity === null || l.rows.some((r) => r.issues.length))
        ? null
        : Math.min(...lines.map((l) => l.capacity!)),
    shortages: lines.filter((l) => (l.shortage ?? 0) > 0).length,
    unknown: lines.filter((l) => l.stock === null).length,
    needsRefresh: lines.some((l) => l.stale),
    provisional: lines.some((l) => l.provisional),
    eligibility: eligibility(rows, observations, b),
  };
}
export function buildRows(p: Project, b: Build): BomRow[] {
  if (!b.revisionId) return p.rows;
  const revision = p.revisions.find((r) => r.id === b.revisionId);
  if (!revision) throw new Error('Missing pinned revision for ' + b.name);
  return revision.rows;
}
export function activeDemand(
  projects: Project[],
  observations: Record<string, Observation>,
  staleMinutes = 30,
) {
  const result = new Map<
    string,
    {
      code: string;
      required: number;
      stock: number | null;
      builds: string[];
      source: string;
      incomplete: boolean;
      stale: boolean;
    }
  >();
  for (const p of projects)
    for (const b of p.builds.filter((x) => x.status === 'planned')) {
      for (const g of grouped(buildRows(p, b))) {
        const key = b.source + ':' + g.code;
        const item = result.get(key) || {
          code: g.code,
          required: 0,
          stock: b.source === 'public' ? (observations[g.code]?.stock ?? null) : null,
          builds: [],
          source: b.source,
          incomplete: false,
          stale: observationNeedsReview(observations[g.code], staleMinutes),
        };
        item.incomplete ||= g.rows.some((r) => r.issues.length > 0 || r.qty === null || r.qty <= 0);
        item.required += quantityRequirement(
          g.qty * multiplier(b),
          b,
          observations[g.code],
          g.code,
        ).required;
        item.builds.push(p.name + ' / ' + b.name);
        result.set(key, item);
      }
    }
  return [...result.values()];
}
export function copyScenarioToWorking(p: Project, id: string): Project {
  const saved = p.builds.find((b) => b.id === id);
  if (!saved) throw new Error('Scenario not found');
  return {
    ...p,
    workingBuild: {
      ...structuredClone(saved),
      id: p.workingBuild.id,
      status: 'scenario',
      basedOnBuildId: id,
    },
  };
}
export function saveScenario(p: Project, name: string, updateId?: string): Project {
  const previous = updateId ? p.builds.find((b) => b.id === updateId) : undefined;
  if (updateId && !previous) throw new Error('Scenario no longer exists');
  const next = {
    ...structuredClone(p.workingBuild),
    id: previous?.id || uid(),
    name,
    status: previous?.status || ('scenario' as const),
    basedOnBuildId: undefined,
  };
  return {
    ...p,
    builds: previous ? p.builds.map((b) => (b.id === previous.id ? next : b)) : [...p.builds, next],
  };
}
export function allocate(lots: InventoryLot[], lotId: string, buildId: string, quantity: number) {
  const lot = lots.find((l) => l.id === lotId);
  if (!lot) throw new Error('Lot not found');
  if (lot.status !== 'received' || lot.source === 'bench')
    throw new Error('Only received JLCPCB stock can be allocated');
  if (!Number.isInteger(quantity) || quantity < 0)
    throw new Error('Allocation must be a nonnegative integer');
  const other = lot.allocations
    .filter((a) => a.buildId !== buildId)
    .reduce((s, a) => s + a.quantity, 0);
  if (other + quantity > lot.quantity) throw new Error('Allocation exceeds available inventory');
  return lots.map((l) =>
    l.id !== lotId
      ? l
      : {
          ...l,
          allocations: [
            ...l.allocations.filter((a) => a.buildId !== buildId),
            ...(quantity ? [{ buildId, quantity }] : []),
          ],
        },
  );
}
