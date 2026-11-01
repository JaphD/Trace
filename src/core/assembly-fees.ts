import type { BomRow, Build, Observation } from './types';

export function componentAssembly(row: BomRow, observation?: Observation) {
  return {
    specialFee: row.assembly?.specialFee ?? observation?.assembly?.specialFee ?? null,
    specialSource:
      row.assembly?.specialFee != null
        ? 'manual'
        : observation?.assembly?.specialFee != null
          ? 'supplier'
          : 'unknown',
  };
}

export function calculateAssemblyFees(
  rows: BomRow[],
  observations: Record<string, Observation>,
  b: Build,
  multiplier: number,
) {
  const parts = rows
    .filter((r) => r.population === 'jlc')
    .map((r) => ({
      id: r.id,
      code: r.code,
      refs: r.refs,
      placed: (r.qty || 0) * multiplier,
      ...componentAssembly(r, observations[r.code]),
    }))
    .filter((p) => p.placed > 0);
  const specialUnknown = parts.filter((p) => p.specialFee === null).length;
  const override = b.assemblyFees?.specialOverride;
  const specialCost = override ?? parts.reduce((s, p) => s + p.placed * (p.specialFee ?? 0), 0);
  const specialComplete = override != null || specialUnknown === 0;
  const assumptions: string[] = [];
  if (!specialComplete)
    assumptions.push(
      'Special-component fees unknown for some parts; refresh metadata or enter a quote amount',
    );
  if ((b.extras.assembly || 0) > 0)
    assumptions.push(
      'Other assembly amounts are manual additions; check that they do not duplicate special-component fees',
    );
  if (override != null)
    assumptions.push(
      'Special-component quote override is a fixed total; recheck it after quantity or BOM changes',
    );
  // Legacy inspection/packaging/SMT inputs stay in saved data but never affect this estimate.
  return { parts, specialUnknown, specialCost, specialComplete, assumptions, total: specialCost };
}
export type AssemblyFeeEstimate = ReturnType<typeof calculateAssemblyFees>;
