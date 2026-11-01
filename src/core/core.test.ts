import { describe, it, expect } from 'vitest';
import { parseBom, detectMapping, reconcileRows, diffRows, editRow } from './bom';
import {
  calculate,
  defaultBuild,
  defaultPricing,
  activeDemand,
  allocate,
  eligibility,
  priceFor,
  saveScenario,
  copyScenarioToWorking,
} from './calculations';
import { migrate, validateWorkspace, mergeWorkspace, emptyWorkspace } from './storage';
import { decodeObservation, updateManualObservation } from './supplier';
import type { BomRow, Observation, Project, InventoryLot } from './types';
const row = (v: Partial<BomRow> = {}): BomRow => ({
  id: 'r1',
  code: 'C1',
  refs: ['R1'],
  qty: 1,
  value: '10k',
  footprint: '0603',
  mpn: '',
  population: 'jlc',
  tags: [],
  notes: '',
  alternatives: [],
  issues: [],
  ...v,
});
const obs = (v: Partial<Observation> = {}): Observation => ({
  code: 'C1',
  model: '10k',
  brand: '',
  description: '',
  footprint: '0603',
  category: 'Resistor',
  stock: 100,
  prices: [
    { startNumber: 1, productPrice: 0.1 },
    { startNumber: 10, productPrice: 0.05 },
  ],
  library: 'basic',
  eligibility: 'economic',
  updatedAt: Date.now(),
  history: [],
  ...v,
});
const project = (rows = [row()]): Project => ({
  id: 'p1',
  name: 'Test',
  description: '',
  rows,
  revisions: [],
  builds: [],
  workingBuild: defaultBuild(),
  createdAt: 1,
  updatedAt: 1,
});
describe('BOM fidelity', () => {
  it('preserves a local manual population choice on reimport without disposition columns', () => {
    const incoming = parseBom('Designator,Qty,LCSC Part\nR1,1,C1').rows;
    const next = reconcileRows([row({ population: 'manual' })], incoming);
    expect(next[0].population).toBe('manual');
  });
  it('changing circuit designators or MPN revokes prior alternative approvals', () => {
    const r = row({
      alternatives: [{ code: 'C2', status: 'approved', notes: 'checked', date: 1 }],
    });
    expect(editRow(r, { refs: ['R7'] }).alternatives[0].status).toBe('candidate');
    expect(editRow(r, { mpn: 'different' }).alternatives[0].status).toBe('candidate');
  });
  it('retains invalid raw quantities but produces a reloadable unresolved row', () => {
    for (const qty of ['-1', '1.5', 'NaN']) {
      const rows = parseBom('Designator,Qty,LCSC Part\nR1,' + qty + ',C1').rows;
      expect(rows[0].qty).toBeNull();
      expect(rows[0].source?.Qty).toBe(qty);
      expect(() =>
        validateWorkspace({ ...emptyWorkspace(), projects: [project(rows)] }),
      ).not.toThrow();
    }
  });
  it('retains missing codes and flags mismatched designators', () => {
    const csv = 'Designator,Quantity,LCSC Part,Value\n"R1,R2",1,C1,10k\nU1,1,,MCU';
    const result = parseBom(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].issues.join(' ')).toMatch(/quantity/i);
    expect(result.rows[1].code).toBe('');
    expect(result.rows[1].issues.join(' ')).toMatch(/code/i);
  });
  it('does not invent quantity for an empty row', () => {
    const r = parseBom('Value,LCSC Part,Quantity\nMCU,C1,').rows[0];
    expect(r.qty).toBeNull();
    expect(r.issues.length).toBeGreaterThan(0);
  });
  it('detects duplicates and DNP', () => {
    const r = parseBom('Designator,Qty,LCSC Part,DNP\nR1,1,C1,yes\nR1,1,C2,no').rows;
    expect(r[0].population).toBe('dnp');
    expect(r.every((x) => x.issues.some((i) => /duplicate/i.test(i)))).toBe(true);
  });
  it('flags ambiguous column detection', () => {
    expect(detectMapping(['LCSC Part', 'JLC Part #', 'Qty']).warnings.length).toBeGreaterThan(0);
  });
  it('keeps notes but invalidates approval on changed part', () => {
    const old = row({
      notes: 'sensitive',
      alternatives: [{ code: 'C2', status: 'approved', notes: 'checked', date: 1 }],
    });
    const next = reconcileRows([old], [row({ id: 'new', code: 'C3' })]);
    expect(next[0].notes).toBe('sensitive');
    expect(next[0].alternatives[0].status).toBe('candidate');
    expect(diffRows([old], next).some((d) => d.kind === 'changed')).toBe(true);
  });
  it('reimport does not duplicate and distinguishes same-code circuit roles', () => {
    const old = [row(), row({ id: 'r2', refs: ['R2'], notes: 'power' })];
    const next = reconcileRows(old, [row({ id: 'x' }), row({ id: 'y', refs: ['R2'] })]);
    expect(next).toHaveLength(2);
    expect(next[1].notes).toBe('power');
  });
});
describe('build engine', () => {
  it('separates owned component value from additional cash needed', () => {
    const b = { ...defaultBuild(), id: 'b', source: 'private' as const, quantity: 5 };
    const lot: InventoryLot = {
      id: 'l',
      code: 'C1',
      quantity: 10,
      source: 'private',
      status: 'received',
      date: 1,
      notes: '',
      unitCost: 2,
      allocations: [{ buildId: 'b', quantity: 8 }],
    };
    const c = calculate([row()], { C1: obs() }, b, defaultPricing(), [lot]);
    expect(c.ownedValue).toBe(10);
    expect(c.total).toBe(c.fixedCost + c.feederCost);
  });
  it('marks invalid or stale combined demand as needing review', () => {
    const p = project([row({ qty: null, issues: ['Missing quantity'] })]);
    p.builds = [{ ...defaultBuild(), status: 'planned' }];
    const result = activeDemand([p], { C1: obs({ updatedAt: 1 }) });
    expect(result[0].incomplete).toBe(true);
    expect(result[0].stale).toBe(true);
  });
  it('editing and resaving a scenario preserves its identity and allocations', () => {
    const p = project();
    p.builds = [{ ...defaultBuild(), id: 'saved', name: 'Pilot', status: 'planned', quantity: 25 }];
    const copied = copyScenarioToWorking(p, 'saved');
    expect(copied.workingBuild.id).toBe(p.workingBuild.id);
    expect(copied.builds).toHaveLength(1);
    copied.workingBuild.quantity = 50;
    const saved = saveScenario(copied, 'Pilot', 'saved');
    expect(saved.builds).toHaveLength(1);
    expect(saved.builds[0].id).toBe('saved');
    expect(saved.builds[0].status).toBe('planned');
    expect(saved.builds[0].quantity).toBe(50);
    expect(() => validateWorkspace({ ...emptyWorkspace(), projects: [saved] })).not.toThrow();
  });
  it('flags stale and failed observations in capacity assumptions', () => {
    const c = calculate(
      [row()],
      { C1: obs({ updatedAt: 1, error: 'Failed' }) },
      defaultBuild(),
      defaultPricing(),
    );
    expect(c.exclusions.join(' ')).toMatch(/stale|failed/i);
  });
  it('aggregates C-numbers before choosing tiers and fees', () => {
    const result = calculate(
      [row({ qty: 6 }), row({ id: 'r2', refs: ['R2'], qty: 6 })],
      { C1: obs({ library: 'extended' }) },
      defaultBuild(),
      defaultPricing(),
    );
    expect(result.lines).toHaveLength(1);
    expect(result.componentCost).toBeCloseTo(1.2);
    expect(result.feederCost).toBe(3.09);
  });
  it('separates preferred exemptions and Standard fees', () => {
    const o = { C1: obs({ library: 'preferred' }) };
    expect(calculate([row()], o, defaultBuild(), defaultPricing()).feederCost).toBe(0);
    expect(
      calculate([row()], o, { ...defaultBuild(), mode: 'standard' }, defaultPricing()).feederCost,
    ).toBe(1.55);
  });
  it('excludes DNP and manual placements', () => {
    expect(
      calculate(
        [row({ population: 'dnp' }), row({ id: 'r2', population: 'manual' })],
        { C1: obs() },
        defaultBuild(),
        defaultPricing(),
      ).lines,
    ).toHaveLength(0);
  });
  it('includes attrition and finds capacity', () => {
    const b = {
      ...defaultBuild(),
      quantity: 10,
      attrition: { C1: { extra: 2, percent: 10, minimum: 0, spares: 0, verified: true } },
    };
    const result = calculate([row({ qty: 2 })], { C1: obs({ stock: 23 }) }, b, defaultPricing());
    expect(result.lines[0].required).toBe(24);
    expect(result.lines[0].shortage).toBe(1);
    expect(result.capacity).toBe(9);
  });
  it('does not turn unknown stock or price into a green zero', () => {
    const result = calculate([row()], {}, defaultBuild(), defaultPricing());
    expect(result.capacity).toBeNull();
    expect(result.unknown).toBe(1);
    expect(result.exclusions.join(' ')).toMatch(/price/i);
  });
  it('multiplies panel data once', () => {
    const o = { C1: obs({ stock: 1000 }) };
    const b = { ...defaultBuild(), quantity: 10, boardsPerPanel: 4, bomBasis: 'board' as const };
    expect(calculate([row()], o, b, defaultPricing()).lines[0].placed).toBe(40);
    expect(
      calculate([row({ qty: 4 })], o, { ...b, bomBasis: 'panel' }, defaultPricing()).lines[0]
        .placed,
    ).toBe(40);
  });
  it('never verifies a board from component eligibility alone', () => {
    expect(eligibility([row()], { C1: obs() }, defaultBuild()).status).toBe('incomplete');
    expect(
      eligibility([row()], { C1: obs({ eligibility: 'standard' }) }, defaultBuild()).status,
    ).toBe('ineligible');
  });
  it('does not turn a below-minimum price tier into an available price', () => {
    expect(priceFor([{ startNumber: 10, productPrice: 1 }], 2)).toBeNull();
  });
  it('counts planned builds only using their pinned revision', () => {
    const p = project();
    p.revisions = [
      {
        id: 'rev',
        name: 'A',
        date: 1,
        rows: [row({ qty: 3 })],
        observations: {},
        build: defaultBuild(),
        pricing: defaultPricing(),
      },
    ];
    p.builds = [
      {
        ...defaultBuild(),
        id: 'b1',
        name: 'Production',
        status: 'planned',
        quantity: 10,
        revisionId: 'rev',
      },
      { ...defaultBuild(), id: 'b2', name: 'Maybe', status: 'scenario', quantity: 500 },
    ];
    expect(activeDemand([p], {}).find((x) => x.code === 'C1')?.required).toBe(30);
  });
  it('rejects double allocation and incoming stock', () => {
    const lot: InventoryLot = {
      id: 'l',
      code: 'C1',
      quantity: 10,
      source: 'private',
      status: 'received',
      date: 1,
      notes: '',
      unitCost: 1,
      allocations: [{ buildId: 'b1', quantity: 8 }],
    };
    expect(() => allocate([lot], 'l', 'b2', 3)).toThrow(/available/i);
    expect(() => allocate([{ ...lot, status: 'incoming' }], 'l', 'b2', 1)).toThrow(/received/i);
  });
});
describe('persistence and supplier truth', () => {
  it('merge remaps scenario edit references without duplicating owned stock', () => {
    const p = project();
    p.builds = [{ ...defaultBuild(), id: 'saved' }];
    p.workingBuild.basedOnBuildId = 'saved';
    const lot: InventoryLot = {
      id: 'physical-lot',
      code: 'C1',
      quantity: 10,
      source: 'private',
      status: 'received',
      date: 1,
      notes: '',
      unitCost: 2,
      allocations: [{ buildId: 'saved', quantity: 5 }],
    };
    const a = { ...emptyWorkspace(), projects: [p], inventory: [lot] };
    const merged = mergeWorkspace(a, a);
    expect(merged.inventory).toHaveLength(1);
    expect(merged.projects[1].workingBuild.basedOnBuildId).toBe(merged.projects[1].builds[0].id);
  });
  it('manual eligibility changes do not refresh old stock or erase a failed lookup', () => {
    const old = obs({ updatedAt: 1, error: 'network error' });
    const next = updateManualObservation('C1', old, { eligibility: 'economic' });
    expect(next.updatedAt).toBe(1);
    expect(next.error).toBe('network error');
    const stock = updateManualObservation('C1', old, { stock: 50 });
    expect(stock.updatedAt).toBeGreaterThan(1);
    expect(stock.manual).toBe(true);
  });
  it('rejects malformed history and revision pricing before restore', () => {
    const w = { ...emptyWorkspace(), observations: { C1: obs({ history: [null] as any }) } };
    expect(() => validateWorkspace(w)).toThrow(/history/i);
    const p = project();
    p.revisions = [
      {
        id: 'r',
        name: 'A',
        date: 1,
        rows: [],
        build: defaultBuild(),
        observations: {},
        pricing: null as any,
      },
    ];
    expect(() => validateWorkspace({ ...emptyWorkspace(), projects: [p] })).toThrow(/pricing/i);
  });
  it('migrates legacy data without committing builds or approving alternatives', () => {
    const w = migrate([
      {
        id: 'p',
        name: 'Legacy',
        parts: [
          {
            componentCode: 'C1',
            requiredQty: 2,
            stockCount: 20,
            prices: [],
            lastUpdated: 1,
            tags: ['RF'],
            alternatives: ['C2'],
          },
        ],
        batchSize: 25,
      },
    ]);
    expect(w.projects[0].workingBuild.quantity).toBe(25);
    expect(w.projects[0].builds).toEqual([]);
    expect(w.projects[0].rows[0].alternatives[0].status).toBe('candidate');
    expect(w.projects[0].rows[0].tags).toEqual(['RF']);
  });
  it('rejects malformed or future backups', () => {
    expect(() => validateWorkspace({ version: 999, projects: [] })).toThrow();
    expect(() => validateWorkspace({ ...emptyWorkspace(), projects: [{ id: 'x' }] })).toThrow();
  });
  it('merges as copies rather than overwriting newer projects', () => {
    const a = { ...emptyWorkspace(), projects: [project()] };
    const b = mergeWorkspace(a, a);
    expect(b.projects).toHaveLength(2);
    expect(new Set(b.projects.map((p) => p.id)).size).toBe(2);
  });
  it('preserves missing stock as unknown and rejects invalid payloads', () => {
    const o = decodeObservation('C1', { code: 200, data: { componentCode: 'C1', prices: [] } });
    expect(o.stock).toBeNull();
    expect(o.eligibility).toBe('unknown');
    expect(() => decodeObservation('C1', { code: 200, data: null })).toThrow();
    expect(() => decodeObservation('C1', { code: 200, data: { componentCode: 'C2' } })).toThrow();
  });
});
