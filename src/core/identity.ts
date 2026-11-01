import type { BomRow, Observation } from './types';

// Do not strip suffixes: memory, temperature and packaging variants can matter.
const normalize = (value: string) => value.toUpperCase().replace(/[\s_-]+/g, '');
export function identityKey(row: BomRow, observation?: Observation) {
  return JSON.stringify([
    row.code,
    row.mpn,
    row.footprint,
    observation?.model || '',
    observation?.footprint || '',
  ]);
}
function packageKey(value: string): string | undefined {
  const text = value.toUpperCase();
  const passive = text.match(
    /(?:^|[^A-Z0-9])(?:[CRL][_-]?)?(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?=$|[^A-Z0-9])/,
  );
  // "0603 (metric)" is not imperial 0603. CAD "C_0603_1608Metric"
  // is still recognized through its first, explicitly separate imperial token.
  if (
    passive &&
    !/^[_\s(,-]*METRIC\b/.test(text.slice(passive.index! + passive[0].length)) &&
    !/METRIC[_\s(,-]*$/.test(text.slice(0, passive.index))
  )
    return 'passive-' + passive[1];
  const ic = text.match(
    /(?:^|[^A-Z0-9])(LQFP|TQFP|LQFN|VQFN|WQFN|QFN|DFN|LGA|BGA|SOIC|SSOP|TSSOP)[_-]?(\d+)(?=$|[^0-9])/,
  );
  if (ic) return ic[1] + '-' + ic[2];
}
export type IdentityWarning = { kind: 'mpn' | 'package'; expected: string; observed: string };
export function identityWarnings(row: BomRow, observation?: Observation): IdentityWarning[] {
  if (!observation || row.identityReview === identityKey(row, observation)) return [];
  const warnings: IdentityWarning[] = [];
  if (
    row.mpn.trim() &&
    observation.model.trim() &&
    normalize(row.mpn) !== normalize(observation.model)
  )
    warnings.push({ kind: 'mpn', expected: row.mpn, observed: observation.model });
  const expected = packageKey(row.footprint),
    observed = packageKey(observation.footprint);
  if (expected && observed && expected !== observed)
    warnings.push({ kind: 'package', expected: row.footprint, observed: observation.footprint });
  return warnings;
}
