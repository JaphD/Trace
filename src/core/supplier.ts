import { type Observation } from './types';
import { priceFor } from './calculations';
const number = (value: unknown): number | null =>
  value !== null &&
  value !== '' &&
  value !== undefined &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
export function decodeObservation(code: string, payload: any, previous?: Observation): Observation {
  const d = payload?.data;
  if (payload?.code !== 200 || !d || d.componentCode !== code)
    throw new Error(payload?.message || 'JLCPCB did not return this component');
  const raw = String(d.componentLibraryType ?? 'unknown').toLowerCase();
  const library: Observation['library'] =
    raw === 'base'
      ? 'basic'
      : raw === 'expand'
        ? 'extended'
        : raw === 'preferred'
          ? 'preferred'
          : 'unknown';
  // JLCPCB's part-page renderer: 0 = Economic and Standard, 2 = Standard Only.
  // Type 1 (Economic Only) cannot be represented by the legacy eligibility model;
  // keep it unknown rather than incorrectly approving Standard. Unrecognized types stay unknown.
  const pcbaType =
    typeof d.componentProductType === 'number' && [0, 1, 2].includes(d.componentProductType)
      ? d.componentProductType
      : null;
  const prices = (Array.isArray(d.prices) ? d.prices : [])
    .map((p) => ({ startNumber: number(p.startNumber), productPrice: number(p.productPrice) }))
    .filter(
      (p) => p.startNumber !== null && p.startNumber >= 1 && p.productPrice !== null,
    ) as Observation['prices'];
  const now = typeof payload.observedAt === 'number' ? payload.observedAt : Date.now(),
    stock = number(d.stockCount);
  const integer = (value: unknown) => {
    const n = number(value);
    return n !== null && Number.isSafeInteger(n) ? n : null;
  };
  const o: Observation = {
    code,
    model: d.componentModelEn || '',
    brand: d.componentBrandEn || '',
    description: d.describe || '',
    footprint: d.componentSpecificationEn || '',
    category: d.firstTypeNameEn || d.firstSortName || '',
    stock,
    prices,
    library,
    rawLibrary: raw,
    eligibility: pcbaType === 2 ? 'standard' : pcbaType === 0 ? 'economic' : 'unknown',
    supplierRules: {
      pcbaType,
      minimum: integer(d.leastPatchNumber),
      extra: integer(d.lossNumber),
      process:
        d.assemblyProcess === 'THT' || d.assemblyMode === 'manualWeld'
          ? 'tht'
          : d.assemblyProcess === 'SMT' || d.assemblyMode === 'smtWeld'
            ? 'smt'
            : 'unknown',
    },
    assembly: {
      xrayFlag: typeof d.xrayFlag === 'boolean' ? d.xrayFlag : null,
      specialFee: number(d.specialComponentFee),
    },
    updatedAt: now,
    attemptedAt: now,
    history: previous?.history || [],
    legacyPriceHistory: previous?.legacyPriceHistory,
  };
  o.history = [
    ...o.history.filter((h) => h.date !== now),
    {
      date: now,
      stock,
      price: priceFor(prices, 1),
      basis: 1,
      currency: 'USD' as const,
      library,
      eligibility: o.eligibility,
    },
  ].slice(-1500);
  return o;
}
const pending = new Map<string, Promise<any>>();
// Imports can arrive while another refresh is running. Drain every queued batch.
export function createRefreshQueue(run: (codes: string[]) => Promise<void>) {
  const codes = new Set<string>();
  let active: Promise<void> | undefined;
  return (incoming: string[]): Promise<void> => {
    incoming.filter((code) => /^C\d+$/.test(code)).forEach((code) => codes.add(code));
    if (!codes.size) return active || Promise.resolve();
    if (!active)
      active = Promise.resolve().then(async () => {
        try {
          while (codes.size) {
            const batch = [...codes];
            codes.clear();
            await run(batch);
          }
        } finally {
          active = undefined;
        }
      });
    return active;
  };
}
export function requestPart(code: string): Promise<any> {
  if (!/^C\d+$/.test(code)) return Promise.reject(new Error('Use a JLCPCB C-number'));
  if (pending.has(code)) return pending.get(code)!;
  const task = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch('/api/part/' + encodeURIComponent(code), {
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Supplier request failed');
      return payload;
    }
  })().finally(() => pending.delete(code));
  pending.set(code, task);
  return task;
}
export async function refreshCodes(
  codes: string[],
  previous: Record<string, Observation>,
  onResult: (code: string, result: Observation | Error) => void,
) {
  const queue = [...new Set(codes.filter((c) => /^C\d+$/.test(c)))];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const code = queue.shift()!;
        try {
          onResult(code, decodeObservation(code, await requestPart(code), previous[code]));
        } catch (e) {
          onResult(code, e instanceof Error ? e : new Error(String(e)));
        }
      }
    }),
  );
}
export function freshness(o: Observation | undefined, minutes = 30) {
  if (!o) return 'Unknown';
  if (o.error) return o.updatedAt ? 'Failed · cached' : 'Failed · unknown';
  if (o.manual)
    return Date.now() - o.updatedAt > minutes * 60000 ? 'Manual · stale' : 'Manual stock';
  return Date.now() - o.updatedAt > minutes * 60000 ? 'Stale' : 'Fresh';
}
export function updateManualObservation(
  code: string,
  previous: Observation | undefined,
  patch: Partial<Observation>,
): Observation {
  const o: Observation = previous || {
    code,
    model: '',
    brand: '',
    description: '',
    footprint: '',
    category: '',
    stock: null,
    prices: [],
    library: 'unknown',
    eligibility: 'unknown',
    updatedAt: 0,
    history: [],
  };
  return {
    ...o,
    ...patch,
    manualUpdatedAt: Date.now(),
    manualFields: [...new Set([...(o.manualFields || []), ...Object.keys(patch)])],
    ...('stock' in patch ? { updatedAt: Date.now(), manual: true, error: undefined } : {}),
  };
}
