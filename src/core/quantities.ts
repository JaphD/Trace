import type { Attrition, Build, Observation } from './types';

export function quantityRule(b: Build, observation: Observation | undefined, code: string) {
  const zero: Attrition = { extra: 0, percent: 0, minimum: 0, spares: 0, verified: false };
  const manual = b.attrition[code];
  if (manual) return { rule: manual, source: 'manual' as const };
  if (b.source === 'private') return { rule: zero, source: 'private' as const };
  // Confirmed by both real quotes: Economic Basic parts do not use the public min/loss floor.
  if (b.mode === 'economic' && observation?.library === 'basic')
    return { rule: { ...zero, verified: true }, source: 'basic' as const };
  const data = observation?.supplierRules;
  if (data?.minimum != null && data.extra != null)
    return {
      rule: { ...zero, extra: data.extra, minimum: data.minimum },
      source: 'supplier' as const,
    };
  return { rule: zero, source: 'unknown' as const };
}

export function quantityRequirement(
  placed: number,
  b: Build,
  observation: Observation | undefined,
  code: string,
) {
  const { rule, source } = quantityRule(b, observation, code);
  const required =
    placed <= 0
      ? 0
      : Math.max(placed + rule.extra + Math.ceil((placed * rule.percent) / 100), rule.minimum) +
        rule.spares;
  return { required, source, rule, provisional: !rule.verified };
}
