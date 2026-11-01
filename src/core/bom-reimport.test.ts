import { describe, expect, it } from 'vitest';
import { parseBom } from './bom';
import { reconcileBom } from './bom-reimport';
import { calculate, defaultBuild, defaultPricing } from './calculations';
const parse = (lines: string) => parseBom('Designator,Qty,LCSC Part,MPN,Footprint\n' + lines).rows;
const approved = { code: 'C2', status: 'approved' as const, notes: 'checked', date: 1 };

describe('designator based BOM reimport', () => {
  it('requires review and drops approval inheritance for any inconsistent incoming quantity', () => {
    const old = parse('R1,1,C1,PART,0603');
    old[0].alternatives = [approved];
    for (const qty of ['7', '0', 'bad']) {
      const result = reconcileBom(old, parse(`R1,${qty},C1,PART,0603`));
      expect(result.needsReview).toBe(true);
      expect(result.rows[0].alternatives).toEqual([]);
    }
  });
  it('does not duplicate previous choices across rows that lack designators', () => {
    const old = parse(',1,C1,PART,0603');
    Object.assign(old[0], {
      alternatives: [approved],
      population: 'manual',
      notes: 'uncertain role',
    });
    const result = reconcileBom(old, parse(',1,C1,PART,0603\n,1,C1,PART,0603'));
    expect(result.needsReview).toBe(true);
    expect(result.rows.every((r) => r.alternatives.length === 0 && r.population === 'jlc')).toBe(
      true,
    );
  });
  it('retains notes, thresholds and critical flags when an existing group splits', () => {
    const old = parse('"R1,R2,R3",3,C1,PART,0603');
    Object.assign(old[0], {
      notes: 'sensitive',
      tags: ['analog'],
      critical: true,
      minStock: 50,
      alternatives: [approved],
    });
    const result = reconcileBom(old, parse('"R1,R2",2,C1,PART,0603\nR3,1,C1,PART,0603'));
    expect(result.rows).toHaveLength(2);
    expect(
      result.rows.every(
        (r) => r.notes === 'sensitive' && r.critical && r.minStock === 50 && r.tags[0] === 'analog',
      ),
    ).toBe(true);
    expect(result.rows.every((r) => r.alternatives[0].status === 'candidate')).toBe(true);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(2);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(false);
  });
  it('keeps merged source rows split to preserve per-circuit notes and population choices', () => {
    const old = parse('R1,1,C1,PART,0603\nR2,1,C1,PART,0603');
    Object.assign(old[0], { notes: 'sense', population: 'manual', alternatives: [approved] });
    Object.assign(old[1], { notes: 'pullup', population: 'dnp' });
    const result = reconcileBom(old, parse('"R1,R2",2,C1,PART,0603'));
    expect(result.rows.map((r) => [r.refs, r.qty, r.notes, r.population])).toEqual([
      [['R1'], 1, 'sense', 'manual'],
      [['R2'], 1, 'pullup', 'dnp'],
    ]);
    expect(result.rows[0].alternatives[0].status).toBe('approved');
    expect(result.rows.map((r) => r.id)).toEqual(old.map((r) => r.id));
  });
  it('does not spread old approvals or notes onto newly added designators', () => {
    const old = parse('R1,1,C1,PART,0603');
    Object.assign(old[0], { notes: 'only R1', alternatives: [approved] });
    const result = reconcileBom(old, parse('"R1,R2",2,C1,PART,0603'));
    expect(result.rows.find((r) => r.refs.includes('R1'))?.notes).toBe('only R1');
    expect(result.rows.find((r) => r.refs.includes('R2'))?.alternatives).toEqual([]);
    expect(result.rows.find((r) => r.refs.includes('R2'))?.notes).toBe('');
    expect(result.rows.reduce((sum, r) => sum + r.qty!, 0)).toBe(2);
  });
  it('respects explicit incoming DNP columns and clears part-specific fee corrections when codes change', () => {
    const old = parse('R1,1,C1,PART,0603');
    Object.assign(old[0], {
      population: 'manual',
      assembly: { specialFee: 0.1 },
      identityReview: 'old',
      alternatives: [approved],
    });
    const incoming = parseBom('Designator,Qty,LCSC Part,DNP\nR1,1,C3,no').rows;
    const result = reconcileBom(old, incoming);
    expect(result.rows[0].population).toBe('jlc');
    expect(result.rows[0].assembly).toBeUndefined();
    expect(result.rows[0].identityReview).toBeUndefined();
    expect(result.rows[0].alternatives[0].status).toBe('candidate');
  });
  it('does not assign conflicting previous metadata when old designators are duplicated', () => {
    const old = parse('R1,1,C1,PART,0603\nR1,1,C2,OTHER,0402');
    old[0].notes = 'keep in snapshot';
    old[0].alternatives = [approved];
    const result = reconcileBom(old, parse('R1,1,C1,PART,0603'));
    expect(result.needsReview).toBe(true);
    expect(result.rows[0].alternatives).toEqual([]);
    expect(result.messages.some((m) => m.review && /ambiguous/i.test(m.message))).toBe(true);
  });
  it('retains mismatched quantities intact instead of distributing an invented count', () => {
    const old = parse('R1,1,C1,PART,0603\nR2,1,C1,PART,0603');
    old[0].notes = 'one';
    old[1].notes = 'two';
    const result = reconcileBom(old, parse('"R1,R2",7,C1,PART,0603'));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].qty).toBe(7);
    expect(result.rows[0].issues).toContain('Quantity does not match designator count');
    expect(result.needsReview).toBe(true);
  });
  it('is stable on repeat imports and preserves aggregated purchase demand', () => {
    const old = parse('R1,1,C1,PART,0603\nR2,1,C1,PART,0603');
    old[0].notes = 'role A';
    old[1].notes = 'role B';
    const incoming = parse('"R1,R2",2,C1,PART,0603');
    const first = reconcileBom(old, incoming),
      second = reconcileBom(first.rows, incoming);
    expect(second.rows).toEqual(first.rows);
    expect(calculate(second.rows, {}, defaultBuild(), defaultPricing()).lines[0].placed).toBe(4);
  });
});
