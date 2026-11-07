import { describe, expect, it } from 'vitest';
import { parseBom, reconcileRows, diffRows } from './bom';
import { defaultBuild } from './calculations';
import {
  emptyWorkspace,
  validateWorkspace,
  removeProject,
  removeAllProjects,
  removeScenario,
  removeRevision,
  editableWorkspace,
} from './storage';
import { createRefreshQueue } from './supplier';

describe('assembly and BOM refinements', () => {
  it('starts a new assembly run at two', () => {
    expect(defaultBuild().quantity).toBe(2);
  });

  it('keeps a part description separate from its value and MPN', () => {
    const parsed = parseBom(
      'Designator,Quantity,LCSC Part,Value,MPN,Description\nR1,1,C25804,10K,RC0603,Resistor 10K 1% 0603',
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      value: '10K',
      mpn: 'RC0603',
      description: 'Resistor 10K 1% 0603',
    });
  });

  it('accepts old rows without descriptions but rejects malformed new descriptions', () => {
    const rows = parseBom('Designator,Qty,LCSC Part\nR1,1,C25804').rows;
    const w = emptyWorkspace();
    w.projects.push({
      id: 'p',
      name: 'Test',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      rows,
      builds: [],
      revisions: [],
      workingBuild: defaultBuild(),
    });
    delete (w.projects[0].rows[0] as any).description;
    expect(() => validateWorkspace(w)).not.toThrow();
    (w.projects[0].rows[0] as any).description = { invalid: true };
    expect(() => validateWorkspace(w)).toThrow(/description/i);
  });
  it('preserves approvals when reimporting a legacy BOM with no description column', () => {
    const text = 'Designator,Qty,LCSC Part\nR1,1,C25804';
    const old = parseBom(text).rows;
    delete old[0].description;
    old[0].alternatives = [
      { code: 'C14663', status: 'approved', notes: 'Circuit checked', date: 1 },
    ];
    const next = reconcileRows(old, parseBom(text).rows);
    expect(next[0].alternatives[0].status).toBe('approved');
    expect(next[0].alternatives[0].notes).toBe('Circuit checked');
    expect(diffRows(old, next)).toEqual([]);
  });
});

describe('project lifecycle', () => {
  it('raises only the editable run to two without changing historical snapshots', () => {
    const w = emptyWorkspace();
    const one = { ...defaultBuild(), quantity: 1, boardReviewed: true };
    w.projects.push({
      id: 'p',
      name: 'Test',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      rows: [],
      builds: [{ ...one, id: 'saved' }],
      workingBuild: one,
      revisions: [
        {
          id: 'rev',
          name: 'Past',
          date: 1,
          rows: [],
          observations: {},
          build: one,
          pricing: w.pricing,
        },
      ],
    });
    const next = editableWorkspace(w);
    expect(next.projects[0].workingBuild.quantity).toBe(2);
    expect(next.projects[0].workingBuild.boardReviewed).toBe(false);
    expect(next.projects[0].revisions[0].build.quantity).toBe(1);
    expect(next.projects[0].builds[0].quantity).toBe(1);
    expect(w.projects[0].workingBuild.quantity).toBe(1);
  });

  it('removes only the selected project and releases its inventory allocations', () => {
    const w = emptyWorkspace();
    const make = (id: string) => ({
      id,
      name: id,
      description: '',
      createdAt: 1,
      updatedAt: 1,
      rows: [],
      builds: [{ ...defaultBuild(), id: id + '-saved' }],
      revisions: [],
      workingBuild: { ...defaultBuild(), id: id + '-working' },
    });
    w.projects = [make('deleted'), make('kept')];
    w.inventory = [
      {
        id: 'lot',
        code: 'C25804',
        quantity: 20,
        source: 'private',
        status: 'received',
        unitCost: 0.1,
        notes: '',
        date: 1,
        allocations: [
          { buildId: 'deleted-working', quantity: 2 },
          { buildId: 'deleted-saved', quantity: 3 },
          { buildId: 'kept-working', quantity: 4 },
        ],
      },
    ];
    const next = removeProject(w, 'deleted');
    expect(next.projects.map((p) => p.id)).toEqual(['kept']);
    expect(next.inventory[0].quantity).toBe(20);
    expect(next.inventory[0].allocations).toEqual([{ buildId: 'kept-working', quantity: 4 }]);
    expect(next.observations).toEqual(w.observations);
    expect(w.projects).toHaveLength(2);
    expect(() => validateWorkspace(next)).not.toThrow();
    const cleared = removeAllProjects(w);
    expect(cleared.projects).toEqual([]);
    expect(cleared.inventory).toEqual([{ ...w.inventory[0], allocations: [] }]);
    expect(cleared.settings).toEqual(w.settings);
    expect(() => validateWorkspace(cleared)).not.toThrow();
    w.projects[0].workingBuild.basedOnBuildId = 'deleted-saved';
    const withoutScenario = removeScenario(w, 'deleted', 'deleted-saved');
    expect(withoutScenario.projects[0].builds).toEqual([]);
    expect(withoutScenario.projects[0].workingBuild.basedOnBuildId).toBeUndefined();
    expect(withoutScenario.projects[0].workingBuild.quantity).toBe(
      w.projects[0].workingBuild.quantity,
    );
    expect(withoutScenario.inventory[0].allocations).toEqual([
      { buildId: 'deleted-working', quantity: 2 },
      { buildId: 'kept-working', quantity: 4 },
    ]);
    expect(w.projects[0].builds).toHaveLength(1);
    expect(() => validateWorkspace(withoutScenario)).not.toThrow();
    const project = w.projects[0];
    project.revisions = [
      {
        id: 'snapshot',
        name: 'Snapshot',
        date: 1,
        rows: structuredClone(project.rows),
        observations: {},
        build: structuredClone(project.workingBuild),
        pricing: w.pricing,
      },
    ];
    const withoutRevision = removeRevision(project, 'snapshot');
    expect(withoutRevision.revisions).toEqual([]);
    expect(project.revisions).toHaveLength(1);
    expect(withoutRevision.rows).toEqual(project.rows);
    project.workingBuild.revisionId = 'snapshot';
    expect(() => removeRevision(project, 'snapshot')).toThrow('pinned');
    project.workingBuild.revisionId = undefined;
    project.builds[0].revisionId = 'snapshot';
    expect(() => removeRevision(project, 'snapshot')).toThrow('pinned');
  });
});

describe('automatic lookup queue', () => {
  it('processes imported codes arriving during an existing refresh without dropping them', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batches: string[][] = [];
    const refresh = createRefreshQueue(async (codes) => {
      batches.push(codes);
      if (batches.length === 1) await gate;
    });
    const first = refresh(['C25804']);
    await Promise.resolve();
    const imported = refresh(['C14663', 'C14663', '', 'invalid', 'C2040']);
    expect(batches).toEqual([['C25804']]);
    release();
    await Promise.all([first, imported]);
    expect(batches).toEqual([['C25804'], ['C14663', 'C2040']]);
    await refresh(['C72043']);
    expect(batches[2]).toEqual(['C72043']);
  });

  it('allows another refresh after an unexpected batch failure', async () => {
    let runs = 0;
    const refresh = createRefreshQueue(async () => {
      if (++runs === 1) throw new Error('failed');
    });
    await expect(refresh(['C25804'])).rejects.toThrow('failed');
    await refresh(['C14663']);
    expect(runs).toBe(2);
  });
});
