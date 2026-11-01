import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBom } from './bom';
import { decodeObservation } from './supplier';
import { calculate, defaultBuild, defaultPricing, activeDemand } from './calculations';
import type { Build, Observation, Project } from './types';
import { emptyWorkspace, validateWorkspace } from './storage';
const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/quote-comparisons.json', import.meta.url), 'utf8'),
);
function fixture(index: number) {
  const f = fixtures[index];
  const rows = parseBom(f.csv).rows;
  const observations: Record<string, Observation> = Object.fromEntries(
    Object.entries(f.payloads).map(([code, payload]) => [code, decodeObservation(code, payload)]),
  );
  const build = { ...defaultBuild(), mode: f.mode } as Build;
  return { f, rows, observations, build };
}
describe('synthetic supplier quantity and quote regressions', () => {
  it('matches independently specified Standard quantities and line amounts', () => {
    const { f, rows, observations, build } = fixture(0);
    const c = calculate(rows, observations, build, defaultPricing());
    for (const target of f.expected) {
      const line = c.lines.find((l) => l.code === target.code)!;
      expect(line.required, target.code).toBe(target.quantity);
      expect(line.cost, target.code).toBeCloseTo(target.cost, 6);
    }
  });
  it('applies the Economic Basic exception and detects placement and purchasing shortages', () => {
    const { f, rows, observations, build } = fixture(1);
    const c = calculate(rows, observations, build, defaultPricing());
    for (const target of f.expected)
      expect(c.lines.find((l) => l.code === target.code)?.required, target.code).toBe(
        target.quantity,
      );
    expect(c.lines.find((l) => l.code === 'C2002')).toMatchObject({
      placed: 2,
      required: 5,
      stock: 4,
      shortage: 1,
      capacity: 0,
    });
    expect(c.shortages).toBe(2);
    expect(c.capacity).toBe(0);
    expect(c.lines.find((l) => l.code === 'C2001')?.required).toBe(18);
  });
  it('does not charge feeder loading for confirmed through-hole processes', () => {
    const { rows, observations, build } = fixture(1);
    const c = calculate(rows, observations, build, defaultPricing());
    for (const code of ['C2004', 'C2005', 'C2006'])
      expect(c.lines.find((l) => l.code === code)?.fee).toBe(0);
  });
  it('rejects Economic eligibility for 0201 packages', () => {
    const { rows, observations, build } = fixture(0);
    const c = calculate(rows, observations, { ...build, mode: 'economic' }, defaultPricing());
    expect(c.eligibility.status).toBe('ineligible');
    expect(c.eligibility.reasons.join(' ')).toMatch(/0201/);
  });
  it('keeps availability independent of quote exclusions and supports a quoted loading total', () => {
    const { rows, observations, build } = fixture(1);
    const c = calculate(
      rows,
      observations,
      {
        ...build,
        costScope: 'selected',
        excludedCodes: ['C2003', 'C2002'],
        loadingOverride: 6.18,
      },
      { ...defaultPricing(), economicExtended: 3.09, economicSetup: 8.24, economicStencil: 1.55 },
    );
    expect(c.shortages).toBe(2);
    expect(c.costLines).toHaveLength(4);
    expect(c.costLines.some((l) => l.code === 'C2002')).toBe(false);
    expect(c.feederCost).toBe(6.18);
    // Parts 2.78 + quoted loading 6.18 + setup 8.24 + stencil 1.55.
    expect(c.total).toBeCloseTo(18.75, 4);
  });
  it('keeps a manual quantity override instead of adding supplier loss twice', () => {
    const { rows, observations, build } = fixture(1);
    const manual = {
      ...build,
      attrition: { C2002: { extra: 0, percent: 0, minimum: 0, spares: 0, verified: true } },
    };
    expect(
      calculate(rows, observations, manual, defaultPricing()).lines.find((l) => l.code === 'C2002')
        ?.required,
    ).toBe(2);
  });
  it('uses the same supplier quantities for combined planned demand', () => {
    const { rows, observations, build } = fixture(1);
    const p: Project = {
      id: 'p',
      name: 'Synthetic project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      rows,
      workingBuild: defaultBuild(),
      revisions: [],
      builds: [{ ...build, status: 'planned' }],
    };
    expect(activeDemand([p], observations).find((l) => l.code === 'C2002')?.required).toBe(5);
  });
  it('applies supplier loss once per shared C-number and respects panel basis', () => {
    const { rows, observations, build } = fixture(0);
    const original = rows.find((r) => r.code === 'C1001')!;
    const shared = [
      { ...original, id: 'a', qty: 4, refs: original.refs.slice(0, 4) },
      { ...original, id: 'b', qty: 4, refs: original.refs.slice(4) },
    ];
    const c = calculate(shared, observations, { ...build, boardsPerPanel: 4 }, defaultPricing());
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].required).toBe(74);
    expect(
      calculate(
        shared,
        observations,
        { ...build, boardsPerPanel: 4, bomBasis: 'panel' },
        defaultPricing(),
      ).lines[0].required,
    ).toBe(26);
  });
  it('does not use public purchasing rules for allocated private stock', () => {
    const { rows, observations, build } = fixture(1);
    const c = calculate(rows, observations, { ...build, source: 'private' }, defaultPricing());
    expect(c.lines.find((l) => l.code === 'C2002')?.required).toBe(2);
    expect(c.lines.find((l) => l.code === 'C2002')?.provisional).toBe(true);
  });
  it('falls back explicitly when old observations have no supplier rules', () => {
    const { rows, observations, build } = fixture(1);
    delete observations.C2002.supplierRules;
    const c = calculate(rows, observations, build, defaultPricing());
    expect(c.lines.find((l) => l.code === 'C2002')).toMatchObject({
      required: 2,
      quantitySource: 'unknown',
      provisional: true,
    });
  });
  it('loads legacy workspaces but rejects malformed new quantity and quote fields', () => {
    const { rows, observations, build } = fixture(1);
    const w = emptyWorkspace();
    w.observations = observations;
    w.projects = [
      {
        id: 'p',
        name: 'P',
        description: '',
        createdAt: 1,
        updatedAt: 1,
        rows,
        workingBuild: build,
        builds: [],
        revisions: [],
      },
    ];
    expect(() => validateWorkspace(w)).not.toThrow();
    w.projects[0].workingBuild.loadingOverride = -1;
    expect(() => validateWorkspace(w)).toThrow(/loading/i);
    delete w.projects[0].workingBuild.loadingOverride;
    observations.C2002.supplierRules!.minimum = -1;
    expect(() => validateWorkspace(w)).toThrow(/supplier rules/i);
  });
});
