import type { BomRow, Observation } from './types';
import { standardOnlyPackage } from './calculations';
type Line = { stock: number | null; shortage: number | null; capacity: number | null };
export type ComponentFilters = {
  stock?: string;
  library?: string;
  service?: string;
  population?: string;
};
export function serviceFor(row: BomRow, o?: Observation) {
  return standardOnlyPackage(row, o) || o?.eligibility === 'standard'
    ? 'standard'
    : o?.eligibility === 'economic'
      ? 'economic'
      : 'unknown';
}
export function matchesComponent(
  row: BomRow,
  o: Observation | undefined,
  line: Line | undefined,
  f: ComponentFilters,
) {
  if (f.library && f.library !== 'all' && (o?.library || 'unknown') !== f.library) return false;
  if (f.service && f.service !== 'all' && serviceFor(row, o) !== f.service) return false;
  if (f.population && f.population !== 'all' && row.population !== f.population) return false;
  if (!f.stock || f.stock === 'all') return true;
  if (row.population !== 'jlc') return false;
  const stock = line?.stock ?? null;
  if (f.stock === 'unknown') return stock === null;
  if (stock === null) return false;
  if (f.stock === 'out') return stock === 0;
  if (f.stock === 'short') return (line?.shortage ?? 0) > 0;
  if (f.stock === 'covered') return line?.shortage === 0;
  return true;
}
export function compareNullable(
  a: number | null | undefined,
  b: number | null | undefined,
  descending = false,
) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return descending ? b - a : a - b;
}
