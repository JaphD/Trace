import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBom } from './bom';
import { decodeObservation } from './supplier';
import { calculate, defaultBuild, defaultPricing } from './calculations';
import { emptyWorkspace, validateWorkspace } from './storage';

const snapshot = JSON.parse(
  fs.readFileSync(new URL('./fixtures/assembly-services.json', import.meta.url), 'utf8'),
);
const code = 'C2913198';
const rows = parseBom(
  'Designator,Quantity,LCSC Part,Footprint\nU1,1,C2913198,WIFIM-SMD_ESP32-S3-WROOM-1-N8',
).rows;
const run = (payload: any, population = 'jlc') =>
  calculate(
    rows.map((r) => ({ ...r, population: population as 'jlc' | 'manual' | 'dnp' })),
    { [code]: decodeObservation(code, payload) },
    defaultBuild(),
    defaultPricing(),
  );

describe('supplier assembly service restrictions', () => {
  it('blocks Economic for a Standard-only module without relying on a small-package heuristic', () => {
    const result = run(snapshot.payloads[code]);
    expect(result.eligibility.status).toBe('ineligible');
    expect(result.eligibility.reasons.some((r) => r.includes('U1: Standard-only'))).toBe(true);
    expect(decodeObservation(code, snapshot.payloads[code]).eligibility).toBe('standard');
    expect(
      calculate(
        rows,
        { [code]: decodeObservation(code, snapshot.payloads[code]) },
        { ...defaultBuild(), mode: 'standard' },
        defaultPricing(),
      ).eligibility.status,
    ).not.toBe('ineligible');
  });

  it('does not incorrectly mark the Economic-capable SIM7080G module Standard-only', () => {
    expect(decodeObservation('C18548266', snapshot.payloads.C18548266).eligibility).toBe(
      'economic',
    );
  });

  it('allows Economic for the explicitly supported type regardless of Extended library status', () => {
    const payload = structuredClone(snapshot.payloads[code]);
    payload.data.componentProductType = 0;
    expect(decodeObservation(code, payload).eligibility).toBe('economic');
    expect(run(payload).eligibility.status).not.toBe('ineligible');
  });

  it.each([undefined, null, false, '2', 9, 1])(
    'keeps unsupported or malformed PCBA type %s unknown',
    (type) => {
      const payload = structuredClone(snapshot.payloads[code]);
      payload.data.componentProductType = type;
      expect(decodeObservation(code, payload).eligibility).toBe('unknown');
      expect(run(payload).eligibility.status).toBe('incomplete');
    },
  );

  it.each(['dnp', 'manual'])('does not let a %s ESP32-S3 block JLCPCB service', (population) => {
    expect(run(snapshot.payloads[code], population).eligibility.status).not.toBe('ineligible');
  });

  it('preserves old backups while rejecting malformed cached PCBA metadata', () => {
    const w = emptyWorkspace();
    const o = decodeObservation(code, snapshot.payloads[code]);
    w.observations[code] = o;
    expect(() => validateWorkspace(w)).not.toThrow();
    delete o.supplierRules!.pcbaType;
    expect(() => validateWorkspace(w)).not.toThrow();
    (o.supplierRules as any).pcbaType = '2';
    expect(() => validateWorkspace(w)).toThrow(/supplier rules/i);
  });
});
