import { describe, it, expect } from 'vitest';
import { parseBom } from './bom';
import { matchesComponent, compareNullable } from './component-view';
import type { Observation } from './types';
const r = parseBom('Designator,Qty,LCSC Part,Footprint\nR1,2,C1,R0603').rows[0];
const o = { library: 'extended', eligibility: 'economic', stock: 10 } as Observation;
const line = { stock: 10, shortage: 2, capacity: 5 };
describe('component view filters', () => {
  it('combines stock, library and service filters', () => {
    expect(
      matchesComponent(r, o, line, { stock: 'short', library: 'extended', service: 'economic' }),
    ).toBe(true);
    expect(matchesComponent(r, o, line, { stock: 'short', library: 'basic' })).toBe(false);
    expect(matchesComponent(r, o, line, { stock: 'covered', library: 'extended' })).toBe(false);
  });
  it('uses build stock, preserves zero and treats missing observations as unknown', () => {
    expect(matchesComponent(r, o, { ...line, stock: 0 }, { stock: 'out' })).toBe(true);
    expect(
      matchesComponent(r, undefined, undefined, {
        stock: 'unknown',
        library: 'unknown',
        service: 'unknown',
      }),
    ).toBe(true);
    expect(matchesComponent(r, o, { ...line, stock: 100, shortage: 0 }, { stock: 'covered' })).toBe(
      true,
    );
  });
  it.each(['dnp', 'manual'] as const)(
    'does not describe %s parts as covered or unknown stock',
    (population) => {
      expect(matchesComponent({ ...r, population }, o, line, { stock: 'short' })).toBe(false);
      expect(
        matchesComponent({ ...r, population }, undefined, undefined, { stock: 'unknown' }),
      ).toBe(false);
      expect(matchesComponent({ ...r, population }, o, line, { population })).toBe(true);
    },
  );
  it('recognizes package-based Standard restrictions without supplier metadata', () => {
    expect(
      matchesComponent({ ...r, footprint: 'C0201' }, undefined, undefined, { service: 'standard' }),
    ).toBe(true);
    expect(matchesComponent({ ...r, footprint: 'C0201' }, o, line, { service: 'economic' })).toBe(
      false,
    );
  });
  it('puts unknown numeric values last in either sort direction and keeps zero first ascending', () => {
    const values = [null, 10, 0, 2];
    expect([...values].sort((a, b) => compareNullable(a, b))).toEqual([0, 2, 10, null]);
    expect([...values].sort((a, b) => compareNullable(a, b, true))).toEqual([10, 2, 0, null]);
  });
});
