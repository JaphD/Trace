import { describe, expect, it } from 'vitest';
import { identityKey, identityWarnings } from './identity';
import { parseBom } from './bom';
import { decodeObservation } from './supplier';
import { defaultBuild } from './calculations';
import { emptyWorkspace, validateWorkspace } from './storage';

const row = () =>
  parseBom(
    'Designator,Qty,LCSC Part,MPN,Footprint\nU1,1,C2913198,ESP32-S3-WROOM-1-N8,ESP32-S3-WROOM-1',
  ).rows[0];
const observation = () =>
  decodeObservation('C2913198', {
    code: 200,
    data: { componentCode: 'C2913198', componentModelEn: 'ESP32-S3-WROOM-1-N4' },
  });

describe('part identity review', () => {
  it('does not read explicit metric package names as imperial dimensions', () => {
    const r = { ...row(), mpn: '', footprint: '0603 (metric)' };
    expect(identityWarnings(r, { ...observation(), footprint: '0201' })).toEqual([]);
    expect(
      identityWarnings(
        { ...r, footprint: 'C_0603_1608Metric' },
        { ...observation(), footprint: '0402' },
      ),
    ).toHaveLength(1);
  });
  it('recognizes LQFN package pin count differences', () => {
    expect(
      identityWarnings(
        { ...row(), mpn: '', footprint: 'LQFP48' },
        { ...observation(), footprint: 'LQFN-56(7x7)' },
      ),
    ).toMatchObject([{ kind: 'package' }]);
  });
  it('flags different memory variants without changing the BOM', () => {
    const r = row();
    const o = { ...observation(), model: 'ESP32-S3-WROOM-1-N4' };
    expect(identityWarnings(r, o).map((w) => w.kind)).toContain('mpn');
    expect(r.mpn).toBe('ESP32-S3-WROOM-1-N8');
  });
  it('ignores only case and separators, not significant suffixes', () => {
    const r = { ...row(), mpn: 'nPM1300-QEAA-R7' };
    expect(identityWarnings(r, { ...observation(), model: 'NPM1300 QEAA R7' })).toEqual([]);
    expect(identityWarnings(r, { ...observation(), model: 'NPM1300-QEAA-R' })).toHaveLength(1);
  });
  it('recognizes imperial sizes within CAD names without treating metric dimensions as sizes', () => {
    const r = { ...row(), mpn: '', footprint: 'Capacitor_SMD:C_0603_1608Metric' };
    expect(identityWarnings(r, { ...observation(), footprint: '0603' })).toEqual([]);
    expect(identityWarnings(r, { ...observation(), footprint: '0402' })).toMatchObject([
      { kind: 'package' },
    ]);
    expect(
      identityWarnings({ ...r, footprint: '1608Metric' }, { ...observation(), footprint: '0603' }),
    ).toEqual([]);
  });
  it('flags known IC family/pin differences and leaves unrecognized footprints to manual review', () => {
    const r = { ...row(), mpn: '', footprint: 'QFN-32_L5.0-W5.0' };
    expect(identityWarnings(r, { ...observation(), footprint: 'QFN-48(6x6)' })).toHaveLength(1);
    expect(identityWarnings(r, { ...observation(), footprint: 'QFN-32(5x5)' })).toEqual([]);
    expect(identityWarnings(r, { ...observation(), footprint: '' })).toEqual([]);
    expect(identityWarnings(r, undefined)).toEqual([]);
  });
  it('acknowledges only the exact pair of imported and supplier identities', () => {
    const r = row(),
      o = { ...observation(), model: 'ESP32-S3-WROOM-1-N4' };
    const reviewed = { ...r, identityReview: identityKey(r, o) };
    expect(identityWarnings(reviewed, o)).toEqual([]);
    expect(identityWarnings(reviewed, { ...o, model: 'ESP32-S3-WROOM-1-N16' })).toHaveLength(1);
    expect(identityWarnings({ ...reviewed, mpn: 'ESP32-S3-WROOM-1-N16' }, o)).toHaveLength(1);
  });
  it('round trips optional acknowledgement and rejects malformed backup values', () => {
    const w = emptyWorkspace();
    w.projects = [
      {
        id: 'p',
        name: 'QA',
        description: '',
        createdAt: 1,
        updatedAt: 1,
        rows: [{ ...row(), identityReview: 'checked identity' }],
        builds: [],
        revisions: [],
        workingBuild: defaultBuild(),
      },
    ];
    expect(
      validateWorkspace(JSON.parse(JSON.stringify(w))).projects[0].rows[0].identityReview,
    ).toBe('checked identity');
    (w.projects[0].rows[0] as any).identityReview = {};
    expect(() => validateWorkspace(w)).toThrow(/identity/i);
  });
});
