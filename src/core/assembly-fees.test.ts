import { describe, expect, it } from 'vitest';
import { calculate, defaultBuild, defaultPricing } from './calculations';
import { decodeObservation } from './supplier';
import { emptyWorkspace, validateWorkspace } from './storage';
import { editRow, parseBom, reconcileRows } from './bom';
import type { BomRow, Observation } from './types';

const row = (patch: Partial<BomRow> = {}): BomRow => ({
  id: 'r',
  code: 'C3025063',
  refs: ['J1'],
  qty: 1,
  value: 'USB C',
  footprint: 'SMD',
  mpn: '',
  population: 'jlc',
  tags: [],
  notes: '',
  alternatives: [],
  issues: [],
  ...patch,
});
const observation = (code = 'C3025063') =>
  decodeObservation(code, {
    code: 200,
    data: {
      componentCode: code,
      componentSpecificationEn: 'SMD',
      stockCount: 10000,
      componentLibraryType: 'base',
      prices: [{ startNumber: 1, productPrice: 0.1 }],
      xrayFlag: false,
      specialComponentFee: 0.03,
    },
  });
const quote = (rows = [row()], b = defaultBuild(), o = { C3025063: observation() }) =>
  calculate(rows, o, b, defaultPricing());

describe('assembly processing fees', () => {
  it('excludes X-ray, packaging and SMT even when old quote overrides are saved', () => {
    const b = {
      ...defaultBuild(),
      mode: 'standard' as const,
      assemblyFees: {
        xrayOverride: 6.6,
        packagingOverride: 0.5,
        smtOverride: 2.07,
        smtJointsPerBom: 609,
      },
    };
    const c = quote([row()], b);
    expect(c.assemblyFees.total).toBeCloseTo(0.06);
    expect(c.total).toBeCloseTo(c.componentCost + c.feederCost + c.fixedCost + 0.06);
    expect(b.assemblyFees.xrayOverride).toBe(6.6);
  });
  it('decodes the observed connector fee without treating missing metadata as zero', () => {
    expect(observation().assembly).toEqual({ xrayFlag: false, specialFee: 0.03 });
    const missing = decodeObservation('C1', { code: 200, data: { componentCode: 'C1' } });
    expect(missing.assembly).toEqual({ xrayFlag: null, specialFee: null });
  });
  it('charges the quoted USB fee per placement, not purchased spares or attrition', () => {
    const b = defaultBuild();
    b.attrition.C3025063 = { extra: 20, minimum: 0, percent: 0, spares: 5, verified: true };
    const c = quote([row()], b);
    expect(c.assemblyFees.specialCost).toBeCloseTo(0.06);
    expect(c.lines[0].required).toBe(27);
  });
  it('counts panel placements once and excludes DNP/manual parts', () => {
    const b = { ...defaultBuild(), quantity: 3, boardsPerPanel: 4 };
    const rows = [
      row(),
      row({ id: 'r2', refs: ['J2'] }),
      row({ id: 'skip', population: 'dnp', qty: 100 }),
    ];
    expect(quote(rows, b).assemblyFees.specialCost).toBeCloseTo(0.72);
    expect(quote(rows, { ...b, bomBasis: 'panel' }).assemblyFees.specialCost).toBeCloseTo(0.18);
    expect(quote([row({ population: 'manual' })], b).assemblyFees.total).toBe(0);
  });
  it('respects per-circuit special-fee overrides', () => {
    const o = observation();
    o.footprint = 'LQFN-56(7x7)';
    const c = quote([row({ assembly: { xray: 'not-required', specialFee: 0 } })], defaultBuild(), {
      C3025063: o,
    });
    expect(c.assemblyFees.specialCost).toBe(0);
  });
  it('excludes board fabrication costs while preserving the original input', () => {
    const b = defaultBuild();
    const before = quote([row()], b).total;
    b.extras.fabrication = 16.37;
    expect(quote([row()], b).total).toBe(before);
    expect(b.extras.fabrication).toBe(16.37);
  });
  it('preserves per-part corrections on reimport but clears them when the C-number changes', () => {
    const old = row({ assembly: { xray: 'required', specialFee: 0.04 } });
    const incoming = parseBom('Designator,Qty,LCSC Part\nJ1,1,C3025063').rows;
    expect(reconcileRows([old], incoming)[0].assembly).toEqual(old.assembly);
    expect(editRow(old, { code: 'C25804' }).assembly).toBeUndefined();
    expect(reconcileRows([old], [row({ code: 'C25804' })])[0].assembly).toBeUndefined();
  });
  it('loads old backups while validating new fee fields', () => {
    const w = emptyWorkspace();
    delete w.pricing.assembly;
    w.projects.push({
      id: 'p',
      name: 'Test',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      rows: [row()],
      workingBuild: defaultBuild(),
      builds: [],
      revisions: [],
    });
    expect(() => validateWorkspace(w)).not.toThrow();
    w.projects[0].rows[0].assembly = { specialFee: -1 };
    expect(() => validateWorkspace(w)).toThrow(/assembly/i);
    w.projects[0].rows[0].assembly = { specialFee: 0 };
    w.projects[0].workingBuild.assemblyFees = { xrayOverride: -1 };
    expect(() => validateWorkspace(w)).toThrow(/assembly/i);
  });
  it('keeps missing special-component fees explicit', () => {
    const o = observation();
    delete o.assembly;
    o.footprint = 'Custom';
    const c = quote([row()], defaultBuild(), { C3025063: o });
    expect(c.assemblyFees.specialComplete).toBe(false);
  });
  it('reconciles the simplified quote excluding PCB services, X-ray, packaging and SMT', () => {
    const rows = Array.from({ length: 37 }, (_, i) =>
      row({ id: String(i), code: i === 36 ? 'C3025063' : 'C' + (i + 1), refs: ['J' + (i + 1)] }),
    );
    const observations: Record<string, Observation> = {};
    rows.forEach((r, i) => {
      const o = observation(r.code);
      o.prices = [{ startNumber: 1, productPrice: i === 0 ? 15.015 : 0 }];
      o.assembly!.specialFee = i === 36 ? 0.03 : 0;
      observations[r.code] = o;
    });
    const b = {
      ...defaultBuild(),
      mode: 'standard' as const,
      assemblyFees: { smtOverride: 2.07, xrayOverride: 6.6 },
    };
    b.extras.fabrication = 16.37;
    const c = calculate(rows, observations, b, defaultPricing());
    expect(c.feederCost).toBeCloseTo(57.35);
    expect(c.componentCost).toBeCloseTo(30.03);
    expect(c.total).toBeCloseTo(132.95 - 2.32 - 6.6 - 0.5 - 2.07);
  });
});
