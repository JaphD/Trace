import { describe, expect, it } from 'vitest';
import { supplierChanges } from './supplier-changes';
import { parseBom } from './bom';
import { defaultBuild } from './calculations';
import { emptyWorkspace } from './storage';
import { decodeObservation } from './supplier';

function workspace() {
  const w = emptyWorkspace();
  w.projects = [
    {
      id: 'p',
      name: 'Board',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      rows: parseBom('Designator,Qty,LCSC Part\nD2,1,C523793').rows,
      builds: [],
      revisions: [],
      workingBuild: { ...defaultBuild(), id: 'working' },
    },
  ];
  w.observations.C523793 = decodeObservation('C523793', {
    code: 200,
    data: {
      componentCode: 'C523793',
      componentLibraryType: 'extended',
      componentProductType: 0,
      stockCount: 4,
      leastPatchNumber: 5,
      lossNumber: 0,
    },
  });
  // The decoder is exercised elsewhere; set stock explicitly for this scenario.
  w.observations.C523793.stock = 4;
  return w;
}
describe('supplier refresh changes', () => {
  it('uses the first successful lookup as baseline after a failed first attempt', () => {
    const before = workspace(),
      after = structuredClone(before);
    before.observations.C523793 = {
      ...before.observations.C523793,
      stock: null,
      library: 'unknown',
      eligibility: 'unknown',
      updatedAt: 0,
      error: 'timeout',
      supplierRules: undefined,
    };
    expect(supplierChanges(before, after, ['C523793'])).toEqual([]);
  });
  it('reports library and service changes with project context', () => {
    const before = workspace(),
      after = structuredClone(before);
    after.observations.C523793.library = 'basic';
    after.observations.C523793.eligibility = 'standard';
    const changes = supplierChanges(before, after, ['C523793']);
    expect(changes.filter((c) => c.kind === 'library')).toMatchObject([
      { projectId: 'p', code: 'C523793' },
    ]);
    expect(changes.some((c) => c.kind === 'service' && c.message.includes('Standard-only'))).toBe(
      true,
    );
  });
  it('compares effective purchase requirements and detects a new shortage', () => {
    const before = workspace(),
      after = structuredClone(before);
    before.observations.C523793.supplierRules!.minimum = 2;
    const changes = supplierChanges(before, after, ['C523793']);
    expect(changes.find((c) => c.kind === 'requirement')?.message).toContain('2 → 5');
    expect(changes.find((c) => c.kind === 'stock')?.message).toContain('short by 1');
  });
  it('reports recovery using supplier minimums, not just placed quantity', () => {
    const before = workspace(),
      after = structuredClone(before);
    after.observations.C523793.stock = 5;
    expect(
      supplierChanges(before, after, ['C523793']).filter((c) => c.kind === 'stock'),
    ).toMatchObject([{ message: expect.stringContaining('now covers') }]);
    expect(supplierChanges(before, before, ['C523793'])).toEqual([]);
  });
  it('does not invent changes on first lookup, failed requests or unknown stock', () => {
    const before = workspace(),
      after = structuredClone(before);
    delete before.observations.C523793;
    expect(supplierChanges(before, after, ['C523793'])).toEqual([]);
    const known = workspace();
    after.observations.C523793 = { ...after.observations.C523793, stock: 10, error: 'failed' };
    expect(supplierChanges(known, after, ['C523793'])).toEqual([]);
    after.observations.C523793 = { ...known.observations.C523793, stock: null };
    expect(supplierChanges(known, after, ['C523793']).filter((c) => c.kind === 'stock')).toEqual(
      [],
    );
  });
  it('keeps projects and planned builds distinct and excludes DNP/manual positions', () => {
    const before = workspace();
    before.projects.push({
      ...structuredClone(before.projects[0]),
      id: 'p2',
      name: 'Other',
      workingBuild: { ...defaultBuild(), id: 'other' },
    });
    before.projects[0].builds = [
      { ...defaultBuild(), id: 'planned', name: 'Ten', status: 'planned', quantity: 10 },
    ];
    const after = structuredClone(before);
    after.observations.C523793.stock = 30;
    const changes = supplierChanges(before, after, ['C523793', 'C523793']);
    expect(
      changes
        .filter((c) => c.kind === 'stock')
        .map((c) => c.buildId)
        .sort(),
    ).toEqual(['other', 'planned', 'working']);
    after.projects.forEach((p) => {
      p.rows[0].population = 'manual';
    });
    expect(supplierChanges(before, after, ['C523793'])).toEqual([]);
  });
});
